const fs = require('fs');

const inputFile = 'postman-results.txt';
const outputFile = 'test-results.xml';

if (!fs.existsSync(inputFile)) {
  console.error(`ERROR: ${inputFile} was not found`);
  process.exit(1);
}

const output = fs.readFileSync(inputFile, 'utf8');

// Find request sections such as:
// Root CUTECH-2856 - List field groups
// Root CUTECH-2857 - Some other test
//
// The Jira key must be present in the request name.
const requestRegex =
  /Root\s+([A-Z][A-Z0-9]+-\d+)\s*-\s*(.+?)(?=\n\s*Root\s+|\n-{20,}|$)/gs;

const testCases = [];

let match;

while ((match = requestRegex.exec(output)) !== null) {
  const testKey = match[1];
  const testName = match[2].trim();

  // Get the block belonging to this request.
  const block = match[0];

  // Determine whether the request itself failed.
  const hasFailure =
  /\[(?:4\d\d|5\d\d)\b[^\]]*\]/i.test(block) ||
  /AssertionError/i.test(block) ||
  /berrored/i.test(block);


  // Count Pass/Fail lines.
  const passed = (block.match(/\bPass\b/g) || []).length;
  const failed = (block.match(/\bFail\b/g) || []).length;

  testCases.push({
    testKey,
    testName,
    hasFailure,
    passed,
    failed,
  });
}

if (testCases.length === 0) {
  console.error('ERROR: No Jira-keyed Postman requests were found.');
  console.error(
    'Expected request names containing keys such as CUTECH-3020.'
  );
  process.exit(1);
}

// Remove duplicate test keys if a collection ever contains
// multiple output sections for the same test.
const uniqueTests = Array.from(
  new Map(testCases.map(test => [test.testKey, test])).values()
);

const escapeXml = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const failures = uniqueTests.filter(test => test.hasFailure).length;

const testCasesXml = uniqueTests
  .map(test => {
    const fullName = `${test.testKey} - ${test.testName}`;

    if (test.hasFailure) {
      return `    <testcase name="${escapeXml(fullName)}" classname="AEP API Regression">
      <properties>
        <property name="test_key" value="${escapeXml(test.testKey)}"/>
      </properties>
      <failure message="Postman test failed">
Postman request or assertion failed.
      </failure>
    </testcase>`;
    }

    return `    <testcase name="${escapeXml(fullName)}" classname="AEP API Regression">
      <properties>
        <property name="test_key" value="${escapeXml(test.testKey)}"/>
      </properties>
    </testcase>`;
  })
  .join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="AEP API Regression" tests="${uniqueTests.length}" failures="${failures}" errors="0">
${testCasesXml}
</testsuite>
`;

fs.writeFileSync(outputFile, xml);

console.log(`JUnit XML created: ${outputFile}`);
console.log(`Tests found: ${uniqueTests.length}`);
console.log(`Tests failed: ${failures}`);
