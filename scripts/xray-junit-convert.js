const fs = require('fs');

const file = 'test-results.xml';

let xml = fs.readFileSync(file, 'utf8');

xml = xml.replace(
  /<testcase([^>]*)name="\[([A-Z]+-\d+)\]\s*([^"]*)"([^>]*)>/g,
  (match, beforeName, key, name, afterName) => {
    return `<testcase${beforeName}name="${name}"${afterName}>
<properties>
<property name="test_key" value="${key}"/>
</properties>`;
  }
);

fs.writeFileSync(file, xml);

console.log('JUnit XML updated for Xray');