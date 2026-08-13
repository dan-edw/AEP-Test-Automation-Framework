const fs = require('fs');

const inputFile = 'postman-results.txt';
const outputFile = 'test-results.xml';

if (!fs.existsSync(inputFile)) {
  throw new Error(`Input file not found: ${inputFile}`);
}

const output = fs.readFileSync(inputFile, 'utf8');

// Find Jira test key and request name.
const requestMatch = output.match(
  /Root\s+([A-Z]+-\d+)\s+-\s+([^\n\r]+)/
);

if (!requestMatch) {
  throw new Error('Could not find Jira test key in Postman output');
}

const testKey = requestMatch[1];
const testName = `${testKey} - ${requestMatch[2].trim()}`;

// Find assertion totals.
const assertionsMatch = output.match(
  /\|\s+assertions\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|/
);

const assertions = assertionsMatch
  ? Number(assertionsMatch[1])
  : 0;

const failedAssertions = assertionsMatch
  ? Number(assertionsMatch[2])
  : 0;

const failures = failedAssertions > 0 ? 1 : 0;

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

let failureXml = '';

if (failures > 0) {
  failureXml = `
    <failure
      message="${escapeXml(
        `${failedAssertions} assertion(s) failed`
      )}">
      ${escapeXml('Postman collection execution failed')}
    </failure>`;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite
  name="AEP API Regression"
  tests="1"
  failures="${failures}"
  errors="0">

  <testcase
    name="${escapeXml(testName)}"
    classname="AEP API Regression">

    <properties>
      <property
        name="test_key"
        value="${escapeXml(testKey)}"/>
    </properties>

${failureXml}

  </testcase>

</testsuite>
`;

fs.writeFileSync(outputFile, xml);

console.log(`JUnit XML created: ${outputFile}`);
console.log(`Test key: ${testKey}`);
console.log(`Test name: ${testName}`);
console.log(`Assertions: ${assertions}`);
console.log(`Failed assertions: ${failedAssertions}`);
console.log(`Tests failed: ${failures}`);
