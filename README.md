# AEP API Regression Test Automation

## Overview

This repository contains an automated API regression test suite for Adobe Experience Platform (AEP) APIs.

The regression tests are executed using the Postman CLI and the results are published to Xray in Jira. The GitHub Actions workflow is designed to:

1. Run the Postman regression collection.
2. Capture the Postman exit code and test output.
3. Generate test result files for reporting.
4. Import JUnit results into Xray.
5. Identify the Xray Test Execution and its Test Runs.
6. Update individual Xray Test Runs with actual results and failure details.
7. Complete the GitHub Actions workflow successfully even when one or more API tests fail, allowing Xray to be used as the source of truth for test results.

---

## Test Execution Flow

```text
GitHub Actions
      |
      v
Run AEP API Regression
      |
      |-- Postman collection
      |-- AEP environment variables
      |-- Capture exit code
      |
      v
Generate / prepare test results
      |
      v
Publish JUnit Results to Xray
      |
      |-- Import test-results.xml
      |-- Create Xray Test Execution
      |-- Retrieve Xray internal execution ID
      |
      v
Update Xray Test Run Results
      |
      |-- Retrieve Test Runs
      |-- Match Jira Test Keys
      |-- Build result comments
      |-- Add actual results / failure details
      |
      v
Final Postman Status
      |
      |-- Report pass/fail
      |-- Do not fail workflow because of test failures
      |
      v
GitHub Actions workflow completes successfully
```

---

## Repository Structure

The workflow expects the following key files/directories:

```text
.
├── postman/
│   ├── collections/
│   │   └── aep-regression/
│   └── environments/
│       └── ci-environment.json
│
├── test-results.xml
├── xray-test-results.json
└── .github/
    └── workflows/
        └── <workflow>.yml
```

The exact workflow filename may vary.

### Postman Collection

The regression collection is located at:

```text
postman/collections/aep-regression
```

The CI environment is located at:

```text
postman/environments/ci-environment.json
```

---

# Prerequisites

The GitHub Actions runner requires the tools used by the workflow, including:

- Bash
- Postman CLI
- `curl`
- `jq`

The workflow uses the Postman CLI to execute the regression collection and uses `curl` and `jq` to communicate with Xray's REST/GraphQL APIs and process the returned JSON.

---

# Required GitHub Actions Configuration

## Secrets

The workflow uses the following GitHub secrets:

| Secret | Purpose |
|---|---|
| `AEP_CLIENT_ID` | AEP authentication client ID |
| `AEP_CLIENT_SECRET` | AEP authentication client secret |
| `AEP_SCOPE` | AEP authentication scope |
| `AEP_IMS_ORG` | AEP IMS organisation |
| `XRAY_PROJECT_KEY` | Xray/Jira project key |
| `XRAY_CLIENT_ID` | Xray/Jira authentication client ID |
| `XRAY_CLIENT_SECRET` | Xray/Jira authentication client secret |
| `POSTMAN_API_KEY` | POSTMAN authentication key |
| `JIRA_URL` | JIRA Environment |

The Xray authentication token is exposed to the workflow through:

```text
XRAY_TOKEN
```

The workflow uses the Xray token as a Bearer token when calling Xray.

## Variables

The workflow uses the following GitHub Actions variable:

| Variable | Purpose |
|---|---|
| `AEP_SANDBOX_NAME` | AEP sandbox name used by the CI environment |

---

# Running the Postman Regression

The workflow runs:

```bash
postman collection run \
  "postman/collections/aep-regression" \
  --environment "postman/environments/ci-environment.json" \
  --reporters cli
```

The Postman output is captured using `tee`:

```bash
postman collection run ... 2>&1 | tee postman-results-raw.txt
```

The actual Postman exit code is then captured using:

```bash
POSTMAN_EXIT_CODE=${PIPESTATUS[0]}
```

This is important because the command is piped through `tee`.

The workflow deliberately does **not** exit with code `1` when Postman reports test failures. This allows the downstream JUnit, Xray and reporting steps to execute.

---

# Postman Result Handling

The raw Postman output is stored as:

```text
postman-results-raw.txt
```

A sanitised copy is created:

```text
postman-results.txt
```

The workflow removes sensitive AEP values from the report before it is used downstream.

The following values are sanitised when present:

- `AEP_CLIENT_SECRET`
- `AEP_CLIENT_ID`
- `AEP_SCOPE`
- `AEP_IMS_ORG`

The Postman exit code is exposed as a step output:

```bash
echo "POSTMAN_EXIT_CODE=$POSTMAN_EXIT_CODE" >> "$GITHUB_OUTPUT"
```

This allows later workflow steps to determine whether the Postman execution passed or failed without stopping the workflow.

---

# Test Result Files

## `test-results.xml`

This is the JUnit result file imported into Xray.

The workflow verifies that the file exists before attempting the Xray import.

## `xray-test-results.json`

This file contains the generated Postman test result information used when updating individual Xray Test Runs.

The workflow uses the test key and result information contained in this file to match Postman results to Xray Test Runs.

A typical result contains information such as:

```json
{
  "testKey": "ABC-123",
  "testName": "Example test",
  "status": "PASS",
  "method": "GET",
  "requestUrl": "https://example.com/api",
  "expectedStatus": "200",
  "actualStatus": "200",
  "assertion": "",
  "failureMessage": ""
}
```

---

# Xray Integration

The workflow uses Xray Cloud APIs to publish and update test results.

## 1. Import JUnit Results

The JUnit results are imported using:

```text
/api/v2/import/execution/junit
```

The project key is supplied using the `XRAY_PROJECT_KEY` environment variable.

A successful import returns an Xray Test Execution key, for example:

```text
ABC-2906
```

The workflow extracts the key from:

```text
xray-import-response.json
```

---

## 2. Retrieve the Xray Test Execution ID

The Xray Test Execution key is used in an Xray GraphQL query to retrieve the internal Xray execution ID.

The workflow constructs the JQL safely before creating the GraphQL request.

The resulting internal ID is stored as a GitHub Actions step output:

```bash
echo "XRAY_EXECUTION_ID=$XRAY_EXECUTION_ID" >> "$GITHUB_OUTPUT"
```

The next workflow step receives it using:

```yaml
XRAY_EXECUTION_ID: ${{ steps.publish-xray.outputs.XRAY_EXECUTION_ID }}
```

This is important because `$GITHUB_OUTPUT` is used to pass values between GitHub Actions steps.

---

## 3. Retrieve Xray Test Runs

Once the internal Test Execution ID has been obtained, the workflow retrieves the Test Runs belonging to that execution.

The results are saved to:

```text
xray-test-runs.json
```

The workflow verifies that Test Runs were returned before continuing.

---

## 4. Match Postman Tests to Xray Test Runs

The workflow matches the Jira/Xray test key from:

```text
xray-test-results.json
```

against the Jira test key returned for each Xray Test Run.

For example:

```text
ABC-2856 -> Xray Test Run ID
ABC-2860 -> Xray Test Run ID
ABC-2865 -> Xray Test Run ID
```

This allows the workflow to update the correct Xray Test Run for each Postman test.

---

# Xray Test Run Comments

For each Postman test, the workflow builds a human-readable comment.

## Failed Test

A failed test comment includes:

- Jira Test key
- Xray Test Run ID
- Failed status
- Actual result
- HTTP method
- Request URL
- Expected HTTP status
- Actual HTTP status
- Assertion
- Failure details

Example:

```text
Jira Test: ABC-123
Xray Test Run: <test-run-id>

Status: FAILED

Actual Result:
The Postman request failed an assertion.

Request:
GET https://example.com/api

Expected HTTP status: 400
Actual HTTP status: 200

Assertion: Status code is 200

Failure Details:
Status code is 200 - expected 400 but got 200
```

## Passed Test

A passing test comment contains:

- Jira Test key
- Xray Test Run ID
- Passed status
- Actual result
- HTTP method
- Request URL
- Expected HTTP status
- Actual HTTP status
- Assertion result

---

# Handling Test Failures

A key design decision in this workflow is that **individual test failures do not stop the workflow before Xray reporting is completed**.

For example, if three tests run:

```text
Total:   3
Passed:  2
Failed:  1
```

Postman/Newman may return:

```text
POSTMAN_EXIT_CODE=1
```

This does **not** mean the workflow should stop immediately.

Instead:

```text
Postman exit code = 1
        |
        v
Continue workflow
        |
        v
Generate results
        |
        v
Publish results to Xray
        |
        v
Update Xray Test Runs
        |
        v
Workflow completes successfully
```

The failed test is recorded in Xray so the test results and failure details can be reviewed there.

---

# Final Workflow Status

The final status step reads the Postman exit code but does not convert a test failure into a GitHub Actions workflow failure.

The intended behaviour is:

### All tests pass

```text
Postman exit code: 0
AEP API Regression passed
```

### One or more tests fail

```text
Postman exit code: 1
AEP API Regression had test failures.
Results have been published to Xray.
The workflow will continue successfully.
```

In both cases the workflow completes successfully.

This is intentional because Xray is being used as the location for reviewing individual test results and failure details.

---

# Troubleshooting

## Postman reports exit code 1

An exit code of `1` indicates that one or more Postman tests/assertions failed.

Check:

```text
xray-test-results.json
```

and the Xray Test Execution for the failed Test Run.

The workflow should still continue and publish the results to Xray.

---

## Xray Test Execution is created but Test Runs are not updated

Check the workflow log for:

```text
Xray execution internal ID
```

and:

```text
Xray Test Runs found
```

If the execution ID is empty, the Xray GraphQL query used to retrieve the internal execution ID should be investigated.

The execution ID is passed from the Publish Results step to the Update Xray Test Run Results step using GitHub Actions step outputs.

---

## `XRAY_EXECUTION_ID` is empty in the next step

The publishing step must write the value to `$GITHUB_OUTPUT`:

```bash
echo "XRAY_EXECUTION_ID=$XRAY_EXECUTION_ID" >> "$GITHUB_OUTPUT"
```

The following step must reference the publishing step ID:

```yaml
XRAY_EXECUTION_ID: ${{ steps.publish-xray.outputs.XRAY_EXECUTION_ID }}
```

---

## Xray GraphQL syntax errors

The Xray execution query should construct the JQL safely rather than manually nesting escaped quotes.

The working approach is:

```bash
JQL="key = $XRAY_EXECUTION_KEY"

EXEC_QUERY=$(jq -n \
  --arg jql "$JQL" \
  '{
    query: (
      "query { getTestExecutions(jql: " +
      ($jql | @json) +
      ", limit: 1, start: 0) { total results { issueId } } }"
    )
  }')
```

This avoids the malformed quoting that can produce errors such as:

```text
Syntax Error: Expected :, found Int
```

---

# Security

Sensitive credentials should be stored in GitHub Actions Secrets rather than committed to the repository.

The workflow also sanitises sensitive AEP values from the Postman report before the report is used downstream.

Do not commit:

- AEP client secrets
- Xray tokens
- Jira authentication credentials
- Other credentials or sensitive environment values

---

# Result Management Philosophy

The workflow separates **test execution status** from **workflow execution status**.

### Test execution status

Determined by Postman:

```text
PASS / FAIL
```

### Reporting status

Determined by whether results can be successfully published and updated in Xray.

### GitHub Actions workflow status

The workflow is designed to complete successfully even when individual regression tests fail, provided the reporting workflow itself can complete.

This allows the team to use Xray to review:

- Which tests passed
- Which tests failed
- Expected HTTP status
- Actual HTTP status
- Assertion failures
- Failure details
- Request information

---

# Summary

The AEP API regression workflow provides an automated path from Postman execution to Xray reporting:

```text
AEP API
   ↓
Postman Regression
   ↓
Postman Results
   ↓
JUnit + JSON Results
   ↓
Xray Test Execution
   ↓
Xray Test Runs
   ↓
Actual Results & Failure Details
   ↓
Xray
```

The workflow is intentionally designed so that **test failures are recorded and visible in Xray without preventing the remainder of the reporting workflow from completing**.
