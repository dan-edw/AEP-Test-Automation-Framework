const fs = require('fs');
const path = require('path');

const resultsFile = path.resolve('postman-results.txt');
const lintResultsFile = path.resolve('postman-lint.txt');
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

let lintOutput = '';

if (fs.existsSync(lintResultsFile)) {
  lintOutput = fs.readFileSync(lintResultsFile, 'utf8');
} else {
  console.log(
    'No postman-lint.txt found. Continuing without collection lint failures.'
  );
}

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
 * Parse Postman collection lint failures
 *
 * Example:
 *
 * CUTECH-2925 - Retrieve a field group.request.yaml:
 *
 * error [FMT015]: Invalid input (path: /pathVariables)
 *
 * Scanned: 6 | Errors: 1 | Warnings: 0 | 17ms
 *
 * The important information is the Jira key and the
 * corresponding lint error.
 * ------------------------------------------------------------
 */

function parseLintFailures(output) {
  const failures = new Map();

  if (!output) {
    return failures;
  }

  const lines = output.split(/\r?\n/);

  let currentKey = null;
  let currentFile = null;
  let currentErrors = [];

  function saveCurrentFailure() {
    if (!currentKey) {
      return;
    }

    if (currentErrors.length === 0) {
      return;
    }

    failures.set(currentKey, {
      key: currentKey,
      file: currentFile || '',
      message: currentErrors.join('\n').trim(),
    });
  }

  for (const line of lines) {
    /*
     * Example:
     *
     * CUTECH-2925 - Retrieve a field group.request.yaml:
     */

    const fileMatch = line.match(
      /^\s*([A-Z][A-Z0-9_]*-\d+)\s+-\s+(.+?\.request\.yaml):\s*$/
    );

    if (fileMatch) {
      saveCurrentFailure();

      currentKey = fileMatch[1];
      currentFile = fileMatch[2];
      currentErrors = [];

      continue;
    }

    /*
     * Example:
     *
     * error [FMT015]: Invalid input (path: /pathVariables)
     */

    const errorMatch = line.match(
      /^\s*error\s+\[([^\]]+)\]:\s*(.+?)\s*$/
    );

    if (errorMatch && currentKey) {
      currentErrors.push(
        `error [${errorMatch[1]}]: ${errorMatch[2]}`
      );

      continue;
    }

    /*
     * Capture additional lint information if it is part
     * of the current failure block.
     */

    if (
      currentKey &&
      line.trim() &&
      currentErrors.length > 0 &&
      !/^Scanned:/i.test(line.trim())
    ) {
      currentErrors.push(line.trim());
    }
  }

  saveCurrentFailure();

  return failures;
}

const lintFailures = parseLintFailures(lintOutput);

console.log('');
console.log('=== Postman Collection Lint Failures ===');

if (lintFailures.size === 0) {
  console.log('No Postman collection lint failures found.');
} else {
  for (const [key, failure] of lintFailures.entries()) {
    console.log(`FAIL ${key}`);

    if (failure.file) {
      console.log(`  File: ${failure.file}`);
    }

    console.log(`  Error: ${failure.message}`);
  }
}

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
   * Check whether this specific test appears in Newman's
   * final failure summary.
   */

  const newmanFailure = newmanFailures.get(test.fullName);

  /*
   * Detect failed assertions inside the request section.
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
   * HTTP failures
   */

  const hasHttpFailure =
    /(?:^|\s)\[(?:4\d\d|5\d\d)\s+[^\]]+\]/.test(
      section
    );

  const failed =
    hasAssertionFailure ||
    hasHttpFailure;

  /*
   * Expected / actual HTTP status
   */

  let expectedStatus =
    newmanFailure?.expectedStatus || '';

  let actualStatus =
    newmanFailure?.actualStatus ||
    execution.status ||
    '';

  /*
   * Passing status assertion
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
   * Assertion name
   */

  let assertion =
    newmanFailure?.assertion || '';

  if (
    !assertion &&
    failedAssertionLines.length > 0
  ) {
    assertion =
      failedAssertionLines[0];
  }

  /*
   * Failure reason
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
   * Assertions
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
 * IMPORTANT:
 *
 * A test with a collection lint failure does NOT consume a
 * Postman execution because Postman never successfully
 * executed that request.
 *
 * This prevents test 5 from being incorrectly assigned
 * to test 4.
 * ------------------------------------------------------------
 */

const usableExecutions = executions.filter(
  (execution) =>
    !execution.url.includes(
      'ims-na1.adobelogin.com'
    )
);

console.log(
  `Using ${usableExecutions.length} usable Postman execution(s)`
);

let executionIndex = 0;

/*
 * ------------------------------------------------------------
 * Build JUnit test cases
 * ------------------------------------------------------------
 */

const testCases = [];
const xrayResults = [];

for (
  let i = 0;
  i < collectionTests.length;
  i++
) {
  const test = collectionTests[i];

  /*
   * ----------------------------------------------------------
   * CASE 1:
   * Collection/request lint failure
   *
   * No Postman execution is consumed.
   * ----------------------------------------------------------
   */

  const lintFailure = lintFailures.get(test.key);

  if (lintFailure) {
    const failureMessage =
      `Postman collection validation failed: ${lintFailure.message}`;

    const failureDetails = [
      `Test: ${test.fullName}`,
      `Status: FAIL`,
      `Failure type: Collection/request validation`,
      `Request definition: ${lintFailure.file || test.fullName}`,
      `Failure: ${lintFailure.message}`,
    ].join('\n');

    xrayResults.push({
      testKey: test.key,
      testName: test.name,
      fullName: test.fullName,
      status: 'FAIL',
      method: '',
      requestUrl: '',
      expectedStatus: '',
      actualStatus: '',
      assertion: '',
      failureMessage,
      assertions: [],
    });

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
        value="FAIL"/>

      <property
        name="failure_type"
        value="REQUEST_VALIDATION"/>

    </properties>

    <failure
      message="${escapeXml(failureMessage)}">${escapeXml(failureDetails)}</failure>

    <system-out>${escapeXml(
      [
        `Test: ${test.fullName}`,
        `Status: FAIL`,
        `Failure type: Collection/request validation`,
        `Request definition: ${lintFailure.file || test.fullName}`,
        '',
        'Failure details:',
        lintFailure.message,
      ].join('\n')
    )}</system-out>

  </testcase>`);

    console.log(
      `FAIL ${test.fullName} - collection/request validation failure`
    );

    continue;
  }

  /*
   * ----------------------------------------------------------
   * CASE 2:
   * No execution available
   * ----------------------------------------------------------
   */

  const execution =
    usableExecutions[executionIndex];

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
      message="No Postman execution found for this Jira test">${escapeXml(
        missingMessage
      )}</error>

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

    console.log(
      `ERROR ${test.fullName} - no Postman execution`
    );

    continue;
  }

  /*
   * Only consume a Postman execution for a test that was
   * actually eligible to run.
   */

  executionIndex++;

  /*
   * ----------------------------------------------------------
   * CASE 3:
   * Normal Postman execution
   * ----------------------------------------------------------
   */

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

  console.log(
    `${status} ${test.fullName}`
  );
}

/*
 * ------------------------------------------------------------
 * Warn if there are unused executions
 * ------------------------------------------------------------
 */

if (executionIndex < usableExecutions.length) {
  console.warn(
    `WARNING: ${usableExecutions.length - executionIndex} ` +
    `Postman execution(s) were not matched to Jira tests.`
  );
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
