const fs = require('fs');
const path = require('path');

const resultsFile = 'postman-results.txt';
const collectionDirectory = 'postman/collections/aep-regression';
const outputFile = 'test-results.xml';

/*
 * ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------
 */

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function findFiles(directory) {
  const results = [];

  if (!fs.existsSync(directory)) {
    return results;
  }

  const entries = fs.readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
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

if (!fs.existsSync(collectionDirectory)) {
  throw new Error(
    `Postman collection directory not found: ${collectionDirectory}`
  );
}

const output = fs.readFileSync(resultsFile, 'utf8');

/*
 * ------------------------------------------------------------
 * Find Postman request files
 * ------------------------------------------------------------
 */

const collectionFiles = findFiles(collectionDirectory);

console.log(
  `Found ${collectionFiles.length} file(s) in collection directory`
);

/*
 * ------------------------------------------------------------
 * Extract Jira test cases from collection files
 *
 * Looks for:
 *
 * name: CUTECH-2856 - List field groups
 *
 * This deliberately uses the actual request definition rather
 * than the Postman CLI Root identifier.
 * ------------------------------------------------------------
 */

const jiraTests = [];

const requestNameRegex =
  /^\s*name:\s*([A-Z][A-Z0-9_]*-\d+)\s+-\s+(.+?)\s*$/m;

for (const file of collectionFiles) {
  let content;

  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.warn(
      `WARNING: Could not read collection file: ${file}`
    );
    continue;
  }

  const match = content.match(requestNameRegex);

  if (!match) {
    continue;
  }

  jiraTests.push({
    key: match[1],
    name: match[2].trim(),
    file,
  });
}

if (jiraTests.length === 0) {
  throw new Error(
    'Could not find any Jira test cases in Postman collection files'
  );
}

console.log('');
console.log(
  `Found ${jiraTests.length} Jira test case(s):`
);

jiraTests.forEach((test, index) => {
  console.log(
    `  ${index + 1}. ${test.key} - ${test.name}`
  );
});

/*
 * ------------------------------------------------------------
 * Parse Postman CLI execution sections
 * ------------------------------------------------------------
 *
 * Postman CLI outputs:
 *
 * Root <identifier>
 *
 * followed by the request execution.
 *
 * The authentication request may be a Root entry without a Jira
 * key, so we do NOT assume every Root is a Jira test.
 * ------------------------------------------------------------
 */

const rootRegex =
  /^Root\s+([A-Za-z0-9_-]+)\s*$/gm;

const executions = [];

let match;

while ((match = rootRegex.exec(output)) !== null) {
  executions.push({
    id: match[1],
    start: match.index,
  });
}

if (executions.length === 0) {
  throw new Error(
    'Could not find any Postman request executions in postman-results.txt'
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

console.log('');
console.log(
  `Found ${executions.length} Postman request execution(s)`
);

/*
 * ------------------------------------------------------------
 * Analyse each Postman request
 * ------------------------------------------------------------
 */

function analyseRequest(section) {
  /*
   * Assertion failure.
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
      error: false,
      message: assertionMatch[0]
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  /*
   * HTTP request failure.
   *
   * Examples:
   *
   * [400 Bad Request, ...]
   * [401 Unauthorized, ...]
   * [403 Forbidden, ...]
   * [404 Not Found, ...]
   * [500 Internal Server Error, ...]
   */

  const httpFailureMatch = section.match(
    /\[(?:4\d\d|5\d\d)\s+[^\]]+\]/
  );

  if (httpFailureMatch) {
    return {
      failed: true,
      error: false,
      message:
        `HTTP request failed: ${httpFailureMatch[0]}`,
    };
  }

  /*
   * Postman request-level errors.
   *
   * Catch common execution errors without requiring the exact
   * wording to remain constant.
   */

  const executionErrorMatch = section.match(
    /(?:Error|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET)[^\n]*/i
  );

  if (
    executionErrorMatch &&
    !/Error:\s+Process completed with exit code/i.test(
      executionErrorMatch[0]
    )
  ) {
    return {
      failed: true,
      error: true,
      message: executionErrorMatch[0]
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }

  return {
    failed: false,
    error: false,
    message: '',
  };
}

/*
 * ------------------------------------------------------------
 * Identify Jira executions
 * ------------------------------------------------------------
 *
 * We need to associate Postman Root sections with the Jira
 * requests.
 *
 * The authentication request is not a Jira test.
 *
 * For normal collection execution:
 *
 * Root authentication
 * Root Jira test 1
 * Root Jira test 2
 * Root Jira test 3
 *
 * We therefore ignore Root entries before the first Jira
 * request execution.
 *
 * We determine this from the collection request count rather
 * than assuming a particular Root ID.
 * ------------------------------------------------------------
 */

const jiraExecutions = executions.slice(-jiraTests.length);

console.log('');
console.log(
  `Using ${jiraExecutions.length} execution(s) for ${jiraTests.length} Jira test(s)`
);

/*
 * ------------------------------------------------------------
 * Build JUnit test cases
 * ------------------------------------------------------------
 */

const testCases = [];

for (let i = 0; i < jiraTests.length; i++) {
  const jiraTest = jiraTests[i];
  const execution = jiraExecutions[i];

  /*
   * Test exists in collection but was not executed.
   */

  if (!execution) {
    testCases.push({
      key: jiraTest.key,
      name: jiraTest.name,
      failed: false,
      error: true,
      message:
        'Test exists in Postman collection but was not executed',
    });

    continue;
  }

  const result = analyseRequest(execution.section);

  testCases.push({
    key: jiraTest.key,
    name: jiraTest.name,
    failed: result.failed,
    error: result.error,
    message: result.message,
  });
}

/*
 * ------------------------------------------------------------
 * Generate testcase XML
 * ------------------------------------------------------------
 */

const testcaseXml = testCases
  .map((test) => {
    let xml = `
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
    </properties>`;


    if (test.error) {
      xml += `
    <error
      message="${escapeXml(
        test.message || 'Postman execution error'
      )}">${escapeXml(
        test.message || 'Postman execution error'
      )}</error>`;
    } else if (test.failed) {
      xml += `
    <failure
      message="${escapeXml(
        test.message || 'Postman test failed'
      )}">${escapeXml(
        test.message || 'Postman test failed'
      )}</failure>`;
    }

    xml += `
  </testcase>`;

    return xml;
  })
  .join('\n');

/*
 * ------------------------------------------------------------
 * Calculate totals
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
 * Generate JUnit document
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
 * Console summary
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
