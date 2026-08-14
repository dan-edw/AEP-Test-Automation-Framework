const fs = require('fs');

const resultsFile = 'postman-results.txt';
const collectionFile = 'postman/collections/aep-regression';
const outputFile = 'test-results.xml';

if (!fs.existsSync(resultsFile)) {
  throw new Error(`Postman results file not found: ${resultsFile}`);
}

if (!fs.existsSync(collectionFile)) {
  throw new Error(`Postman collection not found: ${collectionFile}`);
}

const output = fs.readFileSync(resultsFile, 'utf8');
const collection = fs.readFileSync(collectionFile, 'utf8');

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/*
 * ------------------------------------------------------------
 * 1. Extract Jira test cases from the Postman collection
 * ------------------------------------------------------------
 *
 * Requests are named like:
 *
 *   name: CUTECH-2856 - List field groups
 *   name: CUTECH-2860 - List Schemas
 *   name: CUTECH-2865 - Retrieve a schema
 *
 * We deliberately use the request name as the source of truth
 * for the Jira key.
 */

const jiraTests = [];

const requestNameRegex =
  /^\s*name:\s*([A-Z][A-Z0-9_]*-\d+)\s+-\s+(.+?)\s*$/gm;

let match;

while ((match = requestNameRegex.exec(collection)) !== null) {
  jiraTests.push({
    key: match[1],
    name: match[2].trim(),
  });
}

if (jiraTests.length === 0) {
  throw new Error(
    'Could not find any Jira test cases in the Postman collection'
  );
}

console.log(
  `Found ${jiraTests.length} Jira test case(s) in collection`
);

jiraTests.forEach((test, index) => {
  console.log(
    `  ${index + 1}. ${test.key} - ${test.name}`
  );
});

/*
 * ------------------------------------------------------------
 * 2. Extract executed Postman request sections
 * ------------------------------------------------------------
 *
 * Postman CLI currently outputs:
 *
 *   Root <postman-id>
 *
 * followed by the request details.
 *
 * The first Root is the authentication request, which does not
 * have a Jira key.
 *
 * The remaining Root entries correspond to the Jira requests.
 */

const rootRegex =
  /^Root\s+([A-Za-z0-9_-]+)\s*$/gm;

const executions = [];

while ((match = rootRegex.exec(output)) !== null) {
  executions.push({
    id: match[1],
    start: match.index,
  });
}

if (executions.length === 0) {
  throw new Error(
    'Could not find any Postman request executions in the results'
  );
}

/*
 * Add section boundaries.
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

console.log(
  `Found ${executions.length} Postman request execution(s)`
);

/*
 * ------------------------------------------------------------
 * 3. Analyse a Postman request
 * ------------------------------------------------------------
 *
 * A request is considered failed when its section contains:
 *
 *   AssertionError
 *
 * or an HTTP 4xx / 5xx response.
 */

function analyseRequest(section) {
  /*
   * Assertion failures.
   *
   * Example:
   *
   * AssertionError Status code is 200
   * expected response to have status code 400 but got 200
   */

  const assertionMatch = section.match(
    /AssertionError[\s\S]*?(?=\n\s*\d+\.\s+AssertionError|\nError:\s+Process completed|\s*$)/
  );

  if (assertionMatch) {
    return {
      failed: true,
      message: assertionMatch[0]
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  /*
   * HTTP failures.
   *
   * Example:
   *
   * [401 Unauthorized, ...]
   */

  const httpFailureMatch = section.match(
    /\[(?:4\d\d|5\d\d)\s+[^\]]+\]/
  );

  if (httpFailureMatch) {
    return {
      failed: true,
      message:
        `HTTP request failed: ${httpFailureMatch[0]}`,
    };
  }

  return {
    failed: false,
    message: '',
  };
}

/*
 * ------------------------------------------------------------
 * 4. Match Jira tests to Postman executions
 * ------------------------------------------------------------
 *
 * The first Postman Root is the authentication request.
 *
 * Therefore:
 *
 *   executions[0] -> authentication
 *   executions[1] -> Jira test 1
 *   executions[2] -> Jira test 2
 *   executions[3] -> Jira test 3
 *
 * This matches the collection structure you've shown.
 */

const jiraExecutions = executions.slice(1);

if (jiraExecutions.length !== jiraTests.length) {
  console.warn(
    `WARNING: Collection contains ${jiraTests.length} Jira tests, ` +
    `but Postman executed ${jiraExecutions.length} Jira request(s).`
  );
}

/*
 * ------------------------------------------------------------
 * 5. Generate JUnit test cases
 * ------------------------------------------------------------
 */

const testCases = [];

for (let i = 0; i < jiraTests.length; i++) {
  const jiraTest = jiraTests[i];
  const execution = jiraExecutions[i];

  /*
   * If Postman didn't execute this test, mark it as an error.
   */

  if (!execution) {
    testCases.push({
      key: jiraTest.key,
      name: jiraTest.name,
      failed: true,
      error: true,
      message: 'Test was not executed by Postman',
    });

    continue;
  }

  const result = analyseRequest(execution.section);

  testCases.push({
    key: jiraTest.key,
    name: jiraTest.name,
    failed: result.failed,
    error: false,
    message: result.message,
  });
}

/*
 * ------------------------------------------------------------
 * 6. Generate XML
 * ------------------------------------------------------------
 */

const testcaseXml = testCases.map((test) => {
  let xml = `
  <testcase
    name="${escapeXml(`${test.key} - ${test.name}`)}"
    classname="AEP API Regression">

    <properties>
      <property
        name="test_key"
        value="${escapeXml(test.key)}"/>
    </properties>`;

  if (test.error) {
    xml += `
    <error
      message="${escapeXml(test.message)}">${escapeXml(
        test.message
      )}</error>`;
  } else if (test.failed) {
    xml += `
    <failure
      message="${escapeXml(
        test.message || 'Postman assertion failed'
      )}">${escapeXml(
        test.message || 'Postman assertion failed'
      )}</failure>`;
  }

  xml += `
  </testcase>`;

  return xml;
}).join('\n');

/*
 * ------------------------------------------------------------
 * 7. Collection totals
 * ------------------------------------------------------------
 */

const totalTests = testCases.length;

const failedTests = testCases.filter(
  (test) => test.failed
).length;

const errorTests = testCases.filter(
  (test) => test.error
).length;

const passedTests =
  totalTests - failedTests - errorTests;

/*
 * ------------------------------------------------------------
 * 8. Final JUnit document
 * ------------------------------------------------------------
 */

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite
  name="AEP API Regression"
  tests="${totalTests}"
  failures="${failedTests}"
  errors="${errorTests}">
${testcaseXml}
</testsuite>
`;

fs.writeFileSync(outputFile, xml);

/*
 * ------------------------------------------------------------
 * 9. Output summary
 * ------------------------------------------------------------
 */

console.log('');
console.log(`JUnit XML created: ${outputFile}`);
console.log(`Tests found: ${totalTests}`);
console.log(`Tests passed: ${passedTests}`);
console.log(`Tests failed: ${failedTests}`);
console.log(`Tests errors: ${errorTests}`);

console.log('');
console.log('=== Test Results ===');

for (const test of testCases) {
  if (test.error) {
    console.log(
      `ERROR ${test.key} - ${test.name}`
    );
  } else if (test.failed) {
    console.log(
      `FAIL  ${test.key} - ${test.name}`
    );
  } else {
    console.log(
      `PASS  ${test.key} - ${test.name}`
    );
  }
}
