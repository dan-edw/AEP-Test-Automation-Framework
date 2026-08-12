const fs = require('fs');

const inputFile = 'postman-results.txt';
const outputFile = 'test-results.xml';

const output = fs.readFileSync(inputFile, 'utf8');

// Find Postman request names such as:
// Root CUTECH-2856 - List field groups
const requestMatch = output.match(
  /Root\s+([A-Z]+-\d+)\s+-\s+([^\n\r]+)/
);

if (!requestMatch) {
  throw new Error('Could not find Jira test key in Postman output');
}

const testKey = requestMatch[1];
const testName = `${testKey} - ${requestMatch[2].trim()}`;

// Determine whether the run passed.
// Postman output contains "failed | 0" in the summary when successful.
const assertionsMatch = output.match(
  /\|\s+assertions\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|/
);

const failedAssertions = assertionsMatch
  ? Number(assertionsMatch[2])
  : 0;

const failures = failedAssertions > 0 ? 1 : 0;

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="AEP API Regression" tests="1" failures="${failures}" errors="0">
  <testcase
    name="${escapeXml(testName)}"
    classname="AEP API Regression">
    <properties>
      <property name="test_key" value="${escapeXml(testKey)}"/>
    </properties>
  </testcase>
</testsuite>
`;

fs.writeFileSync(outputFile, xml);

console.log(`JUnit XML created: ${outputFile}`);
console.log(`Test key: ${testKey}`);
console.log(`Test name: ${testName}`);
console.log(`Tests failed: ${failures}`);