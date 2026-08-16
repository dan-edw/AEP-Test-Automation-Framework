const fs = require('fs');
const path = require('path');

const inputFile = path.resolve('postman-results.txt');
const outputFile = path.resolve('test-results.xml');

if (!fs.existsSync(inputFile)) {
  throw new Error(`Postman results file not found: ${inputFile}`);
}

if (!fs.statSync(inputFile).isFile()) {
  throw new Error(`Postman results path is not a file: ${inputFile}`);
}

const output = fs.readFileSync(inputFile, 'utf8');

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/*
 * Find Jira test cases in the Postman output.
 *
 * Example:
 *
 * Root CUTECH-2856 - List field groups
 * Root CUTECH-2860 - List Schemas
 * Root CUTECH-2865 - Retrieve a schema
 *
 * We also allow the Jira project key to contain numbers/underscores.
 */
const requestRegex =
  /^Root\s+([A-Z][A-Z0-9_]*-\d+)\s+-\s+([^\r\n]+)/gm;

const requests = [];

let match;

while ((match = requestRegex.exec(output)) !== null) {
  requests.push({
    key: match[1],
    name: match[2].trim(),
    start: match.index,
  });
}

if (requests.length === 0) {
  throw new Error(
    'Could not find any Jira test cases in Postman output. ' +
    'Check that Postman request names contain a Jira key such as CUTECH-2856.'
  );
}

/*
 * Identify the end of each request section.
 */
for (let i = 0; i < requests.length; i++) {
  requests[i].end =
    i + 1 < requests.length
      ? requests[i + 1].start
      : output.length;

  requests[i].section = output.substring(
    requests[i].start,
    requests[i].end
  );
}

/*
 * Extract the HTTP request information.
 *
 * Example:
 *
 * GET https://platform.adobe.io/... [200 OK, 1.87 KB, 2 s]
 */
function extractRequest(section) {
  const requestMatch = section.match(
    /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+\[(\d{3})\s+([^\]]+)\]/m
  );

  if (!requestMatch) {
    return {
      method: '',
      url: '',
      actualStatus: '',
      statusText: '',
    };
  }

  return {
    method: requestMatch[1],
    url: requestMatch[2],
    actualStatus: requestMatch[3],
    statusText: requestMatch[4].split(',')[0].trim(),
  };
}

/*
 * Extract expected and actual status codes from assertion failures.
 *
 * Example:
 *
 * expected response to have status code 400 but got 200
 */
function extractExpectedActual(section) {
  const match = section.match(
    /expected response to have status code\s+(\d+)\s+but got\s+(\d+)/i
  );

  if (!match) {
    return {
      expectedStatus: '',
      actualStatusFromAssertion: '',
    };
  }

  return {
    expectedStatus: match[1],
    actualStatusFromAssertion: match[2],
  };
}

/*
 * Extract the assertion name.
 *
 * Example:
 *
 * AssertionError Status code is 200
 */
function extractAssertion(section) {
  const match = section.match(
    /AssertionError\s+([^\r\n]+)/
  );

  return match ? match[1].trim() : '';
}

/*
 * Extract the Postman failure detail.
 */
function extractFailure(section) {
  const failureIndex = section.indexOf('# failure detail');

  if (failureIndex === -1) {
    return '';
  }

  const failureText = section.substring(failureIndex);

  /*
   * Remove the heading and collapse whitespace.
   */
  return failureText
    .replace(/^# failure detail\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Extract individual Pass/Fail assertion lines.
 *
 * Examples:
 *
 * Pass Status code is 200
 * Pass Response is JSON
 * Pass Results are an array
 * 1. Status code is 200
 */
function extractAssertions(section) {
  const assertions = [];

  const lines = section.split(/\r?\n/);

  for (const line of lines) {
    const passMatch = line.match(
      /^\s*Pass\s+(.+?)\s*$/
    );

    if (passMatch) {
      assertions.push({
        status: 'PASS',
        name: passMatch[1].trim(),
      });

      continue;
    }

    const numberedMatch = line.match(
      /^\s*\d+\.\s+(.+?)\s*$/
    );

    if (numberedMatch) {
      assertions.push({
        status: 'FAIL',
        name: numberedMatch[1].trim(),
      });
    }
  }

  return assertions;
}

/*
 * Analyse an individual Postman request.
 */
function analyseRequest(request) {
  const section = request.section;

  const http = extractRequest(section);

  const expectedActual = extractExpectedActual(section);

  const assertion = extractAssertion(section);

  const failure = extractFailure(section);

  const assertions = extractAssertions(section);

  /*
   * Detect HTTP-level failures.
   */
  const hasHttpFailure =
    /\[(?:4\d\d|5\d\d)\s+[^\]]+\]/.test(section);

  /*
   * Detect assertion failures.
   */
  const hasAssertionFailure =
    /AssertionError/i.test(section) ||
    assertions.some((item) => item.status === 'FAIL');

  const failed =
    hasHttpFailure || hasAssertionFailure;

  /*
   * Prefer the expected/actual values extracted from
   * an assertion failure.
   */
  const expectedStatus =
    expectedActual.expectedStatus ||
    '';

  const actualStatus =
    expectedActual.actualStatusFromAssertion ||
    http.actualStatus ||
    '';

  let failureMessage = '';

  if (hasAssertionFailure) {
    if (expectedStatus && actualStatus) {
      failureMessage =
        `${assertion || 'Assertion failed'} - ` +
        `expected ${expectedStatus} but got ${actualStatus}`;
    } else if (failure) {
      failureMessage = failure;
    } else {
      failureMessage =
        assertion || 'Postman assertion failed';
    }
  } else if (hasHttpFailure) {
    failureMessage =
      `HTTP request failed: ${http.actualStatus} ${http.statusText}`;
  }

  return {
    failed,
    method: http.method,
    url: http.url,
    expectedStatus,
    actualStatus,
    assertion,
    assertions,
    failure,
    failureMessage,
  };
}

/*
 * Build JUnit test cases.
 */
const testCases = requests.map((request) => {
  const result = analyseRequest(request.section);

  const status = result.failed ? 'FAIL' : 'PASS';

  let testcase = `
  <testcase
    name="${escapeXml(request.key)}"
    classname="AEP API Regression">

    <properties>
      <property
        name="test_key"
        value="${escapeXml(request.key)}"/>

      <property
        name="test_name"
        value="${escapeXml(request.name)}"/>

      <property
        name="status"
        value="${status}"/>

      <property
        name="method"
        value="${escapeXml(result.method)}"/>

      <property
        name="expected_status"
        value="${escapeXml(result.expectedStatus)}"/>

      <property
        name="actual_status"
        value="${escapeXml(result.actualStatus)}"/>
    </properties>`;

  /*
   * Add detailed failure information.
   */
  if (result.failed) {
    const failureDetails = [
      `Assertion: ${result.assertion || 'N/A'}`,
      `Expected HTTP status: ${result.expectedStatus || 'N/A'}`,
      `Actual HTTP status: ${result.actualStatus || 'N/A'}`,
      `Request: ${result.method || 'N/A'} ${result.url || 'N/A'}`,
      `Failure: ${result.failureMessage || 'Postman test failed'}`,
    ].join('\n');

    testcase += `

    <failure
      message="${escapeXml(
        result.failureMessage || 'Postman test failed'
      )}">${escapeXml(failureDetails)}</failure>`;
  }

  /*
   * Add execution details for both PASS and FAIL.
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
    `Test key: ${request.key}`,
    `Test name: ${request.name}`,
    `Status: ${status}`,
    `Method: ${result.method || 'N/A'}`,
    `Request URL: ${result.url || 'N/A'}`,
    `Expected HTTP status: ${result.expectedStatus || 'N/A'}`,
    `Actual HTTP status: ${result.actualStatus || 'N/A'}`,
    '',
    'Assertions:',
    assertionDetails,
    '',
    result.failed
      ? `Failure reason: ${result.failureMessage || 'Postman test failed'}`
      : 'Failure reason: None',
  ].join('\n');

  testcase += `

    <system-out>${escapeXml(executionDetails)}</system-out>

  </testcase>`;

  return testcase;
});

/*
 * Collection totals.
 */
const totalTests = requests.length;

const analysedResults = requests.map((request) =>
  analyseRequest(request.section)
);

const failedTests = analysedResults.filter(
  (result) => result.failed
).length;

const passedTests = totalTests - failedTests;

/*
 * Generate JUnit XML.
 */
const xml = `<?xml version="1.0" encoding="UTF-8"?>

<testsuite
  name="AEP API Regression"
  tests="${totalTests}"
  failures="${failedTests}"
  errors="0">

${testCases.join('\n')}

</testsuite>
`;

fs.writeFileSync(outputFile, xml, 'utf8');

/*
 * Console summary.
 */
console.log(`JUnit XML created: ${outputFile}`);
console.log(`Tests found: ${totalTests}`);
console.log(`Tests passed: ${passedTests}`);
console.log(`Tests failed: ${failedTests}`);
console.log(`Tests errors: 0`);

console.log('');
console.log('=== Test Results ===');

requests.forEach((request, index) => {
  const status = analysedResults[index].failed
    ? 'FAIL'
    : 'PASS';

  console.log(
    `${status} ${request.key} - ${request.name}`
  );
});
