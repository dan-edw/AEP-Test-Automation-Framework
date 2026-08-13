const fs = require('fs');

const inputFile = 'postman-results.txt';
const outputFile = 'test-results.xml';

if (!fs.existsSync(inputFile)) {
  throw new Error(`Postman results file not found: ${inputFile}`);
}

const output = fs.readFileSync(inputFile, 'utf8');

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/*
* Find Postman request headings such as:
*
* Root CUTECH-2856 - List field groups
* Root CUTECH-2860 - List Schemas
* Root CUTECH-2865 - Retrieve a schema
*
* We deliberately capture only the request name on the Root line.
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
    'Could not find any Jira test keys in Postman output'
  );
}

/*
* Add the end position for each request section.
*
* This allows us to analyse each Postman request independently
* rather than treating the entire collection as one test.
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
* Determine whether an individual request failed.
*
* We primarily look for assertion failures inside that request's
* section. We also recognise obvious HTTP failure responses.
*/
function analyseRequest(section) {
  const assertionFailures = [
    ...section.matchAll(
      /AssertionError[\s\S]*?(?=\n\s*\d+\.\s+AssertionError|\s*$)/g
    ),
  ];

  const hasAssertionFailure =
    assertionFailures.length > 0;

  const hasHttpFailure =
    /\[(?:4\d\d|5\d\d)\s+[^\]]+\]/.test(section);

  const failed =
    hasAssertionFailure || hasHttpFailure;

  let failureMessage = '';

  if (hasAssertionFailure) {
    const firstFailure = assertionFailures[0][0]
      .replace(/\s+/g, ' ')
      .trim();

    failureMessage = firstFailure;
  } else if (hasHttpFailure) {
    const httpFailure = section.match(
      /\[(?:4\d\d|5\d\d)\s+[^\]]+\]/
    );

    failureMessage = httpFailure
      ? `HTTP request failed: ${httpFailure[0]}`
      : 'HTTP request failed';
  }

  return {
    failed,
    failureMessage,
  };
}

/*
* Build JUnit testcase XML for every Jira test.
*/
const testCases = requests.map((request) => {
  const result = analyseRequest(request.section);

  let testcase = `
  <testcase
    name="${escapeXml(`${request.key} - ${request.name}`)}"
    classname="AEP API Regression">

    <properties>
      <property
        name="test_key"
        value="${escapeXml(request.key)}"/>
    </properties>`;

  if (result.failed) {
    testcase += `
    <failure
      message="${escapeXml(
        result.failureMessage || 'Postman test failed'
      )}">
${escapeXml(
  result.failureMessage || 'Postman test failed'
)}
    </failure>`;
  }

  testcase += `
  </testcase>`;

  return testcase;
});

/*
* Collection-level totals.
*/
const totalTests = requests.length;

const failedTests = requests.filter((request) => {
  return analyseRequest(request.section).failed;
}).length;

const passedTests = totalTests - failedTests;

/*
* Generate the final JUnit document.
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

fs.writeFileSync(outputFile, xml);

console.log(`JUnit XML created: ${outputFile}`);
console.log(`Tests found: ${totalTests}`);
console.log(`Tests passed: ${passedTests}`);
console.log(`Tests failed: ${failedTests}`);
