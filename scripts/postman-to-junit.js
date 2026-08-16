const fs = require('fs');
const path = require('path');

const resultsFile = path.resolve('postman-results.txt');
const collectionDir = path.resolve('postman/collections/aep-regression');
const outputFile = path.resolve('test-results.xml');

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
 * We look for request names such as:
 *
 * CUTECH-2856 - List field groups
 *
 * This deliberately does NOT depend on the Postman CLI
 * "Root" output.
 * ------------------------------------------------------------
 */

const jiraRegex =
  /\b([A-Z][A-Z0-9_]*-\d+)\s+-\s+([^\r\n"]+)/;

const collectionTests = [];

for (const file of collectionFiles) {
  let content;

  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  /*
   * YAML/Postman request files normally contain:
   *
   * name: CUTECH-2856 - List field groups
   *
   * Capture the complete name from a name: line.
   */
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

    /*
     * Avoid duplicates.
     */
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
    'Could not find any Jira test cases in the Postman collection files.'
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
 *
 * We still use the CLI output to determine the actual result.
 *
 * Example:
 *
 * GET https://platform.adobe.io/... [200 OK, ...]
 *
 * Pass Status code is 200
 *
 * or:
 *
 * AssertionError Status code is 200
 * expected response to have status code 400 but got 200
 *
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
 * Split Postman output into execution sections.
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
 * Analyse an execution
 * ------------------------------------------------------------
 */

function analyseExecution(execution) {
  const section = execution.section;

  const assertionFailures = [
    ...section.matchAll(
      /AssertionError\s+([^\r\n]+)[\s\S]*?(?=\n\s*\d+\.\s+AssertionError|\s*$)/gi
    ),
  ];

  const hasAssertionFailure =
    assertionFailures.length > 0 ||
    /expected response to have status code\s+\d+\s+but got\s+\d+/i.test(
      section
    );

  const hasHttpFailure =
    /(?:^|\s)\[(?:4\d\d|5\d\d)\s+[^\]]+\]/.test(
      section
    );

  const failed =
    hasAssertionFailure || hasHttpFailure;

  /*
   * Expected / actual status from assertion.
   */
  const expectedActual = section.match(
    /expected response to have status code\s+(\d+)\s+but got\s+(\d+)/i
  );

  const expectedStatus =
    expectedActual?.[1] || '';

  const actualStatus =
    expectedActual?.[2] ||
    execution.status ||
    '';

  /*
   * Assertion name.
   */
  const assertionMatch = section.match(
    /AssertionError\s+([^\r\n]+)/i
  );

  const assertion =
    assertionMatch?.[1]?.trim() || '';

  /*
   * Failure reason.
   */
  let failureMessage = '';

  if (expectedStatus && actualStatus) {
    failureMessage =
      `${assertion || 'Assertion failed'} - ` +
      `expected ${expectedStatus} but got ${actualStatus}`;
  } else if (hasHttpFailure) {
    failureMessage =
      `HTTP request failed: ` +
      `${execution.status} ${execution.statusText}`;
  } else if (assertion) {
    failureMessage = assertion;
  }

  /*
   * Assertions.
   */
  const assertions = [];

  for (const line of section.split(/\r?\n/)) {
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

    const fail = line.match(
      /^\s*\d+\.\s+(.+?)\s*$/
    );

    if (
      fail &&
      !/^Root\s+/i.test(fail[1])
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
 * Match executions to Jira tests.
 * ------------------------------------------------------------
 *
 * Because Postman CLI does not reliably output the Jira key,
 * we use execution order.
 *
 * The collection request order and Postman execution order
 * must therefore correspond.
 * ------------------------------------------------------------
 */

const usableExecutions = executions.filter(
  (execution) =>
    !execution.url.includes('ims-na1.adobelogin.com')
);

console.log(
  `Using ${Math.min(
    usableExecutions.length,
    collectionTests.length
  )} execution(s) for ${collectionTests.length} Jira test(s)`
);

if (usableExecutions.length < collectionTests.length) {
  console.warn(
    `WARNING: Only ${usableExecutions.length} ` +
    `Postman executions were found for ` +
    `${collectionTests.length} Jira tests.`
  );
}

/*
 * ------------------------------------------------------------
 * Build JUnit testcases
 * ------------------------------------------------------------
 */

const testCases = [];

for (let i = 0; i < collectionTests.length; i++) {
  const test = collectionTests[i];
  const execution = usableExecutions[i];

  /*
   * If an execution is missing, mark it as an error rather
   * than silently reporting the test as passed.
   */
  if (!execution) {
    testCases.push(`
  <testcase
    name="${escapeXml(test.key)}"
    classname="AEP API Regression">

    <properties>
      <property name="test_key" value="${escapeXml(test.key)}"/>
      <property name="test_name" value="${escapeXml(test.name)}"/>
      <property name="status" value="ERROR"/>
    </properties>

    <error
      message="No Postman execution found for this Jira test">
No Postman execution was found for ${escapeXml(test.fullName)}.
    </error>

  </testcase>`);

    continue;
  }

  const result = analyseExecution(execution);

  const status =
    result.failed ? 'FAIL' : 'PASS';

  /*
   * Properties.
   */
  let testcase = `
  <testcase
    name="${escapeXml(test.key)}"
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
   * Failure.
   */
  if (result.failed) {
    const failureDetails = [
      `Test: ${test.fullName}`,
      `Method: ${execution.method}`,
      `Request URL: ${execution.url}`,
      `Expected HTTP status: ${result.expectedStatus || 'N/A'}`,
      `Actual HTTP status: ${result.actualStatus || 'N/A'}`,
      `Assertion: ${result.assertion || 'N/A'}`,
      `Failure: ${result.failureMessage || 'Postman test failed'}`,
    ].join('\n');

    testcase += `

    <failure
      message="${escapeXml(
        result.failureMessage ||
        'Postman test failed'
      )}">${escapeXml(failureDetails)}</failure>`;
  }

  /*
   * Detailed execution output for PASS and FAIL.
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

const totalTests = collectionTests.length;

const failedTests = testCases.filter((testcase) =>
  testcase.includes('<failure')
).length;

const errorTests = testCases.filter((testcase) =>
  testcase.includes('<error')
).length;

const passedTests =
  totalTests - failedTests - errorTests;

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
 * Summary
 * ------------------------------------------------------------
 */

console.log('');
console.log('JUnit XML created:', outputFile);
console.log(`Tests found: ${totalTests}`);
console.log(`Tests passed: ${passedTests}`);
console.log(`Tests failed: ${failedTests}`);
console.log(`Tests errors: ${errorTests}`);

console.log('');
console.log('=== Test Results ===');

collectionTests.forEach((test, index) => {
  const testcase = testCases[index];

  let status = 'PASS';

  if (testcase.includes('<failure')) {
    status = 'FAIL';
  } else if (testcase.includes('<error')) {
    status = 'ERROR';
  }

  console.log(
    `${status} ${test.fullName}`
  );
});
