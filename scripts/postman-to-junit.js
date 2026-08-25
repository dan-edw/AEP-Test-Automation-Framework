const fs = require('fs');
const path = require('path');

const resultsFile = path.resolve('postman-results.txt');
const collectionDir = path.resolve('postman/collections/aep-regression');

const outputFile = path.resolve('test-results.xml');
const xrayResultsFile = path.resolve('xray-test-results.json');

/*
 * ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------
 */

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/*
 * ------------------------------------------------------------
 * Validate input files
 * ------------------------------------------------------------
 */

if (!fs.existsSync(resultsFile)) {
  throw new Error(
    `Postman results file not found: ${resultsFile}`
  );
}

if (!fs.statSync(resultsFile).isFile()) {
  throw new Error(
    `Postman results path is not a file: ${resultsFile}`
  );
}

if (!fs.existsSync(collectionDir)) {
  throw new Error(
    `Postman collection directory not found: ${collectionDir}`
  );
}

if (!fs.statSync(collectionDir).isDirectory()) {
  throw new Error(
    `Expected collection directory but found: ${collectionDir}`
  );
}

const output = fs.readFileSync(resultsFile, 'utf8');

/*
 * ------------------------------------------------------------
 * Find Postman collection files
 * ------------------------------------------------------------
 */

function getFilesRecursive(directory) {
  const results = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...getFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

const collectionFiles = getFilesRecursive(collectionDir);

console.log(
  `Found ${collectionFiles.length} file(s) in collection directory`
);

/*
 * ------------------------------------------------------------
 * Extract Jira test cases from collection files
 *
 * Expected request name:
 *
 * CUTECH-2856 - List field groups
 * ------------------------------------------------------------
 */

const collectionTests = [];

for (const file of collectionFiles) {
  let content;

  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const nameRegex =
    /^\s*name:\s*["']?([^"'\r\n]+?)["']?\s*$/gm;

  let match;

  while ((match = nameRegex.exec(content)) !== null) {
    const name = match[1].trim();

    const jiraMatch = name.match(
      /^([A-Z][A-Z0-9_]*-\d+)\s+-\s+(.+)$/
    );

    if (!jiraMatch) {
      continue;
    }

    const key = jiraMatch[1];
    const testName = jiraMatch[2].trim();

    if (
      collectionTests.some(
        (test) => test.key === key
      )
    ) {
      continue;
    }

    collectionTests.push({
      key,
      name: testName,
      fullName: `${key} - ${testName}`,
      file,
    });
  }
}

if (collectionTests.length === 0) {
  throw new Error(
    'Could not find any Jira test cases in the Postman collection files. ' +
    'Check that Postman request names contain a Jira key such as CUTECH-2856.'
  );
}

console.log(
  `Found ${collectionTests.length} Jira test case(s):`
);

collectionTests.forEach((test, index) => {
  console.log(
    `${index + 1}. ${test.fullName}`
  );
});

/*
 * ------------------------------------------------------------
 * Parse Postman execution output
 * ------------------------------------------------------------
 */

const executionRegex =
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+\[(\d{3})\s+([^\]]+)\]/gm;

const executions = [];

let executionMatch;

while (
  (executionMatch = executionRegex.exec(output)) !== null
) {
  executions.push({
    method: executionMatch[1],
    url: executionMatch[2],
    status: executionMatch[3],
    statusText: executionMatch[4].split(',')[0].trim(),
    start: executionMatch.index,
  });
}

console.log(
  `Found ${executions.length} Postman request execution(s)`
);

/*
 * ------------------------------------------------------------
 * Split Postman output into execution sections
 * ------------------------------------------------------------
 */

for (let i = 0; i < executions.length; i++) {
  executions[i].end =
    i + 1 < executions.length
      ? executions[i + 1].start
      : output.length;

  executions[i].section = output.substring(
    executions[i].start,
    executions[i].end
  );
}

/*
 * ------------------------------------------------------------
 * Parse Newman final failure summary
 *
 * Newman reports assertion failures at the END of the run,
 * rather than inside the individual request execution section.
 *
 * Example:
 *
 * AssertionError Status code is 200
 * expected response to have status code 400 but got 200
 * at assertion:0 in test-script
 * inside "CUTECH-2865 - Retrieve a schema"
 * ------------------------------------------------------------
 */

function parseNewmanFailures(output) {
  const failures = new Map();

  const failureRegex =
    /AssertionError\s+([^\r\n]+)\s*\r?\n\s*expected response to have status code\s+(\d+)\s+but got\s+(\d+)[\s\S]*?inside\s+"([^"]+)"/gi;

  let match;

  while ((match = failureRegex.exec(output)) !== null) {
    const assertion = match[1].trim();
    const expectedStatus = match[2];
    const actualStatus = match[3];
    const fullName = match[4].trim();

    failures.set(fullName, {
      assertion,
      expectedStatus,
      actualStatus,
      failureMessage:
        `${assertion} - expected ${expectedStatus} but got ${actualStatus}`,
    });
  }

  return failures;
}

const newmanFailures = parseNewmanFailures(output);

console.log('');
console.log('=== Newman Failure Summary ===');

if (newmanFailures.size === 0) {
  console.log('No Newman assertion failures found.');
} else {
  for (const [fullName, failure] of newmanFailures.entries()) {
    console.log(`FAIL ${fullName}`);
    console.log(`  Assertion: ${failure.assertion}`);
    console.log(`  Expected: ${failure.expectedStatus}`);
    console.log(`  Actual:   ${failure.actualStatus}`);
  }
}



/*
 * ------------------------------------------------------------
 * Analyse one execution
 * ------------------------------------------------------------
 */

function analyseExecution(execution, test) {
  const section = execution.section;

  /*
   * ----------------------------------------------------------
   * Check whether this specific test appears in Newman's
   * final failure summary.
   * ----------------------------------------------------------
   */

  const newmanFailure = newmanFailures.get(test.fullName);

  /*
   * ----------------------------------------------------------
   * Detect failed assertions inside the request section.
   *
   * Newman displays failed assertions as:
   *
   * 1. Status code is 200
   * 2. Status code is 200
   *
   * Successful assertions are displayed as:
   *
   * Pass Status code is 200
   *
   * Therefore a numbered assertion is considered a failure.
   * ----------------------------------------------------------
   */

  const failedAssertionLines = [];

  for (const line of section.split(/\r?\n/)) {
    const fail = line.match(
      /^\s*\d+\.\s+(.+?)\s*$/
    );

    if (
      fail &&
      !/^Root\s+/i.test(fail[1]) &&
      !/^AssertionError\s+/i.test(fail[1])
    ) {
      failedAssertionLines.push(fail[1].trim());
    }
  }

  const hasAssertionFailure =
    !!newmanFailure ||
    failedAssertionLines.length > 0;

  /*
   * ----------------------------------------------------------
   * HTTP failures
   *
   * A 4xx/5xx response is considered an HTTP failure only when
   * it wasn't already represented by an assertion failure.
   * ----------------------------------------------------------
   */

  const hasHttpFailure =
    /(?:^|\s)\[(?:4\d\d|5\d\d)\s+[^\]]+\]/.test(
      section
    );

  const failed =
    hasAssertionFailure || hasHttpFailure;

  /*
   * ----------------------------------------------------------
   * Expected / actual HTTP status
   *
   * First preference:
   * Newman final failure summary.
   *
   * This is the authoritative source for failed assertions.
   * ----------------------------------------------------------
   */

  let expectedStatus =
    newmanFailure?.expectedStatus || '';

  let actualStatus =
    newmanFailure?.actualStatus ||
    execution.status ||
    '';

  /*
   * ----------------------------------------------------------
   * Passing tests
   *
   * Successful status assertion appears as:
   *
   * Pass Status code is 200
   *
   * Extract 200 from that line.
   * ----------------------------------------------------------
   */

  if (!expectedStatus) {
    const passedStatusAssertion = section.match(
      /Pass\s+Status code is\s+(\d+)/i
    );

    if (passedStatusAssertion) {
      expectedStatus =
        passedStatusAssertion[1];
    }
  }

  /*
   * ----------------------------------------------------------
   * Assertion name
   * ----------------------------------------------------------
   */

  let assertion =
    newmanFailure?.assertion || '';

  /*
   * If Newman did not provide the failure summary, use the
   * failed assertion line from the request section.
   */

  if (
    !assertion &&
    failedAssertionLines.length > 0
  ) {
    assertion =
      failedAssertionLines[0];
  }

  /*
   * ----------------------------------------------------------
   * Failure reason
   * ----------------------------------------------------------
   */

  let failureMessage =
    newmanFailure?.failureMessage || '';

  if (
    !failureMessage &&
    expectedStatus &&
    actualStatus &&
    failed
  ) {
    failureMessage =
      `${assertion || 'Assertion failed'} - ` +
      `expected ${expectedStatus} but got ${actualStatus}`;
  }

  if (
    !failureMessage &&
    hasHttpFailure
  ) {
    failureMessage =
      `HTTP request failed: ` +
      `${execution.status} ${execution.statusText}`;
  }

  if (
    !failureMessage &&
    assertion &&
    failed
  ) {
    failureMessage = assertion;
  }

  /*
   * ----------------------------------------------------------
   * Assertions
   * ----------------------------------------------------------
   */

  const assertions = [];

  for (const line of section.split(/\r?\n/)) {

    /*
     * PASS assertion
     */

    const pass = line.match(
      /^\s*Pass\s+(.+?)\s*$/
    );

    if (pass) {
      assertions.push({
        status: 'PASS',
        name: pass[1].trim(),
      });

      continue;
    }

    /*
     * FAIL assertion
     *
     * Newman prints failed assertions as:
     *
     * 1. Status code is 200
     *
     * Do not treat Root or AssertionError lines as
     * assertions.
     */

    const fail = line.match(
      /^\s*\d+\.\s+(.+?)\s*$/
    );

    if (
      fail &&
      !/^Root\s+/i.test(fail[1]) &&
      !/^AssertionError\s+/i.test(fail[1])
    ) {
      assertions.push({
        status: 'FAIL',
        name: fail[1].trim(),
      });
    }
  }

  /*
   * ----------------------------------------------------------
   * Return structured result
   * ----------------------------------------------------------
   */

  return {
    failed,
    expectedStatus,
    actualStatus,
    assertion,
    failureMessage,
    assertions,
  };
}


/*
 * ------------------------------------------------------------
 * Match executions to Jira tests
 *
 * Authentication request is excluded.
 *
 * Collection order and Postman execution order must correspond.
 * ------------------------------------------------------------
 */

const usableExecutions = executions.filter(
  (execution) =>
    !execution.url.includes(
      'ims-na1.adobelogin.com'
    )
);

console.log(
  `Using ${Math.min(
    usableExecutions.length,
    collectionTests.length
  )} execution(s) for ${collectionTests.length} Jira test(s)`
);

if (
  usableExecutions.length <
  collectionTests.length
) {
  console.warn(
    `WARNING: Only ${usableExecutions.length} ` +
    `Postman executions were found for ` +
    `${collectionTests.length} Jira tests.`
  );
}

/*
 * ------------------------------------------------------------
 * Build JUnit test cases
 * ------------------------------------------------------------
 */

const testCases = [];

/*
 * This is the structured data that will be written to
 * xray-test-results.json.
 */
const xrayResults = [];

for (
  let i = 0;
  i < collectionTests.length;
  i++
) {
  const test = collectionTests[i];
  const execution = usableExecutions[i];

  /*
   * Missing Postman execution
   */
  if (!execution) {
    const missingMessage =
      `No Postman execution was found for ${test.fullName}.`;

    testCases.push(`
  <testcase
    name="${escapeXml(test.fullName)}"
    classname="AEP API Regression">

    <properties>
      <property
        name="test_key"
        value="${escapeXml(test.key)}"/>

      <property
        name="test_name"
        value="${escapeXml(test.name)}"/>

      <property
        name="status"
        value="ERROR"/>
    </properties>

    <error
      message="No Postman execution found for this Jira test">
${escapeXml(missingMessage)}
    </error>

  </testcase>`);

    xrayResults.push({
      testKey: test.key,
      testName: test.name,
      fullName: test.fullName,
      status: 'ERROR',
      method: '',
      requestUrl: '',
      expectedStatus: '',
      actualStatus: '',
      assertion: '',
      failureMessage: missingMessage,
      assertions: [],
    });

    continue;
  }

  const result =
  analyseExecution(execution, test);

  const status =
    result.failed ? 'FAIL' : 'PASS';

  /*
   * ----------------------------------------------------------
   * Add structured Xray result
   * ----------------------------------------------------------
   */

  xrayResults.push({
    testKey: test.key,
    testName: test.name,
    fullName: test.fullName,

    status,

    method: execution.method,
    requestUrl: execution.url,

    expectedStatus:
      result.expectedStatus || '',

    actualStatus:
      result.actualStatus || '',

    assertion:
      result.assertion || '',

    failureMessage:
      result.failureMessage || '',

    assertions:
      result.assertions,
  });

  /*
   * ----------------------------------------------------------
   * JUnit properties
   * ----------------------------------------------------------
   */

  let testcase = `
  <testcase
    name="${escapeXml(test.fullName)}"
    classname="AEP API Regression">

    <properties>

      <property
        name="test_key"
        value="${escapeXml(test.key)}"/>

      <property
        name="test_name"
        value="${escapeXml(test.name)}"/>

      <property
        name="status"
        value="${status}"/>

      <property
        name="method"
        value="${escapeXml(execution.method)}"/>

      <property
        name="request_url"
        value="${escapeXml(execution.url)}"/>

      <property
        name="expected_status"
        value="${escapeXml(result.expectedStatus)}"/>

      <property
        name="actual_status"
        value="${escapeXml(result.actualStatus)}"/>

    </properties>`;

  /*
   * ----------------------------------------------------------
   * JUnit failure
   * ----------------------------------------------------------
   */

  if (result.failed) {
    const failureDetails = [
      `Test: ${test.fullName}`,
      `Method: ${execution.method}`,
      `Request URL: ${execution.url}`,
      `Expected HTTP status: ${result.expectedStatus || 'N/A'}`,
      `Actual HTTP status: ${result.actualStatus || 'N/A'}`,
      `Assertion: ${result.assertion || 'N/A'}`,
      `Failure: ${
        result.failureMessage ||
        'Postman test failed'
      }`,
    ].join('\n');

    testcase += `

    <failure
      message="${escapeXml(
        result.failureMessage ||
        'Postman test failed'
      )}">${escapeXml(failureDetails)}</failure>`;
  }

  /*
   * ----------------------------------------------------------
   * Detailed execution output
   * ----------------------------------------------------------
   */

  const assertionDetails =
    result.assertions.length > 0
      ? result.assertions
          .map(
            (item) =>
              `${item.status}: ${item.name}`
          )
          .join('\n')
      : 'No assertion details captured';

  const executionDetails = [
    `Test: ${test.fullName}`,
    `Status: ${status}`,
    `Method: ${execution.method}`,
    `Request URL: ${execution.url}`,
    `Expected HTTP status: ${
      result.expectedStatus || 'N/A'
    }`,
    `Actual HTTP status: ${
      result.actualStatus || 'N/A'
    }`,
    '',
    'Assertions:',
    assertionDetails,
    '',
    result.failed
      ? `Failure reason: ${
          result.failureMessage ||
          'Postman test failed'
        }`
      : 'Failure reason: None',
  ].join('\n');

  testcase += `

    <system-out>${escapeXml(
      executionDetails
    )}</system-out>

  </testcase>`;

  testCases.push(testcase);
}

/*
 * ------------------------------------------------------------
 * Totals
 * ------------------------------------------------------------
 */

const totalTests =
  collectionTests.length;

const failedTests =
  testCases.filter((testcase) =>
    testcase.includes('<failure')
  ).length;

const errorTests =
  testCases.filter((testcase) =>
    testcase.includes('<error')
  ).length;

const passedTests =
  totalTests -
  failedTests -
  errorTests;

/*
 * ------------------------------------------------------------
 * Generate JUnit XML
 * ------------------------------------------------------------
 */

const xml = `<?xml version="1.0" encoding="UTF-8"?>

<testsuite
  name="AEP API Regression"
  tests="${totalTests}"
  failures="${failedTests}"
  errors="${errorTests}">

${testCases.join('\n')}

</testsuite>
`;

fs.writeFileSync(
  outputFile,
  xml,
  'utf8'
);

/*
 * ------------------------------------------------------------
 * Generate Xray JSON
 * ------------------------------------------------------------
 */

const xrayOutput = {
  generatedAt: new Date().toISOString(),

  suite: 'AEP API Regression',

  summary: {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    errors: errorTests,
  },

  tests: xrayResults,
};

fs.writeFileSync(
  xrayResultsFile,
  JSON.stringify(
    xrayOutput,
    null,
    2
  ) + '\n',
  'utf8'
);

/*
 * ------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------
 */

console.log('');

console.log(
  'JUnit XML created:',
  outputFile
);

console.log(
  'Xray test results created:',
  xrayResultsFile
);

console.log(
  `Tests found: ${totalTests}`
);

console.log(
  `Tests passed: ${passedTests}`
);

console.log(
  `Tests failed: ${failedTests}`
);

console.log(
  `Tests errors: ${errorTests}`
);

console.log('');

console.log(
  '=== Test Results ==='
);

collectionTests.forEach(
  (test, index) => {
    const testcase =
      testCases[index];

    let status = 'PASS';

    if (
      testcase.includes('<failure')
    ) {
      status = 'FAIL';
    } else if (
      testcase.includes('<error')
    ) {
      status = 'ERROR';
    }

    console.log(
      `${status} ${test.fullName}`
    );
  }
);

console.log('');

console.log(
  '=== Xray Test Results ==='
);

xrayResults.forEach(
  (result) => {
    console.log(
      `${result.status} ${result.testKey} - ${result.testName}`
    );

    if (result.failureMessage) {
      console.log(
        `  Failure: ${result.failureMessage}`
      );
    }
  }
);
