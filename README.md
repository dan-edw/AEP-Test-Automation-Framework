# Karate API Testing - Manual Approach

Guide for writing and running Karate API tests manually.

---

## 📂 Project Structure

```
├── pom.xml                             ← Maven configuration
├── .github/workflows/
│   └── karate-tests.yml               ← CI/CD automation
├── src/test/
│   ├── java/
│   │   ├── karate-config.js           ← ⚙️ Configure API URL here
│   │   └── runners/
│   │       ├── TestRunner.java        ← Run all tests
│   │       └── ParallelRunner.java    ← Run tests in parallel
│   └── resources/features/            ← ✍️ Write your tests here
│       ├── generated/
│       └── [your-test-folders]/
└── target/karate-reports/             ← Test reports (auto-generated)
```

---

## 📋 Prerequisites

**Required:**
- **Java JDK 11+** 
- **Apache Maven 3.6+** 

**Verify installation:**
```bash
java -version    # Should show 11 or higher
mvn -version     # Should show 3.6 or higher
```



---

## 🚀 Quick Start

### 1. Install Dependencies (First Time)
```bash
mvn clean install -DskipTests
```

### 2. Configure API URL
Edit `src/test/java/karate-config.js`:
```javascript
var config = {
  baseUrl: 'https://your-api-url.com',  // ← Change this
  timeout: 30000
};
```

### 3. Run Tests
```bash
mvn test
```

### 4. View Report
```bash
open target/karate-reports/karate-summary.html
```

---

## ✍️ Writing Tests

### Basic Feature File

Create: `src/test/resources/features/users/get-users.feature`

```gherkin
Feature: User API Tests

  Background:
    * url baseUrl
    * header Content-Type = 'application/json'

  Scenario: Get all users
    Given path '/users'
    When method GET
    Then status 200
    And match response == '#[]'

  Scenario: Get user by ID
    * def userId = 1
    Given path '/users/', userId
    When method GET
    Then status 200
    And match response.id == userId
    And match response.name == '#string'
```

### Data-Driven Tests

```gherkin
  Scenario Outline: Create user - <testCase>
    Given path '/users'
    And request { "name": "<name>", "email": "<email>" }
    When method POST
    Then status <status>

    Examples:
      | testCase    | name      | email             | status |
      | valid       | John Doe  | john@example.com  | 201    |
      | invalid     | Test      | invalid-email     | 400    |
```

---

## 🏃 Running Tests

```bash
# Run all tests
mvn test

# Run specific feature file
mvn test -Dkarate.options="classpath:features/users/get-users.feature"

# Run with environment
mvn test -Dkarate.env=dev
mvn test -Dkarate.env=qa

# Run with tags
mvn test -Dkarate.options="--tags @smoke"
mvn test -Dkarate.options="--tags ~@skip"

# Run in parallel
mvn test -Dtest=ParallelRunner

# Clean and run
mvn clean test
```

---

## 📖 Karate Syntax Reference

### HTTP Methods
```gherkin
When method GET
When method POST
When method PUT
When method DELETE
```

### Paths & Parameters
```gherkin
Given path '/users'
Given path '/users/', userId
And param page = 1
And param limit = 10
```

### Headers
```gherkin
And header Authorization = 'Bearer ' + token
And header Content-Type = 'application/json'
```

### Request Body
```gherkin
# Inline
And request { name: 'John', email: 'john@test.com' }

# Multiline
And request
  """
  {
    "name": "John Doe",
    "email": "john@example.com"
  }
  """
```

### Assertions
```gherkin
Then status 200
And match response.name == 'John Doe'
And match response.id == '#number'
And match response.email == '#string'
And match response.active == '#boolean'
And match response.id == '#notnull'
And match response == '#[]'           # Non-empty array
And match response == '#[10]'         # Exactly 10 items
```

### Variables
```gherkin
* def userId = 123
* def newId = response.id
Given path '/users/', userId
```

### Tags
```gherkin
@smoke @users
Scenario: Critical test
```

---

## ⚙️ Configuration (karate-config.js)

```javascript
function fn() {
  var env = karate.env || 'dev';
  
  var config = {
    baseUrl: 'https://api.example.com',
    timeout: 30000
  };
  
  if (env === 'dev') {
    config.baseUrl = 'https://dev-api.example.com';
  } else if (env === 'qa') {
    config.baseUrl = 'https://qa-api.example.com';
  } else if (env === 'prod') {
    config.baseUrl = 'https://api.example.com';
  }
  
  return config;
}
```

---

## 🚢 CI/CD with GitHub Actions

Workflow file: `.github/workflows/karate-tests.yml`

**Features:**
- Runs on push to main/develop branches
- Runs on pull requests
- Manual trigger available
- Uploads test reports as artifacts
- Multi-environment support

**View Results:**
1. Go to GitHub repository → Actions tab
2. Click latest workflow run
3. Download "karate-test-reports" artifact

---

## 📊 Test Reports

After running tests:
- **HTML Report:** `target/karate-reports/karate-summary.html`
- **Timeline:** `target/karate-reports/karate-timeline.html`
- **XML Reports:** `target/surefire-reports/*.xml`

---

## 🗂️ Test Organization

```
features/
├── users/
│   ├── get-users.feature
│   ├── create-user.feature
│   └── update-user.feature
├── products/
│   └── get-products.feature
└── auth/
    └── login.feature
```

**Best Practices:**
- Group by domain/resource (users, products, etc.)
- Use descriptive file names (get-users.feature, not test1.feature)
- Add tags (@smoke, @regression)
- Use Background for common setup
- Keep tests independent

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| `mvn: command not found` | Install Maven |
| `java: command not found` | Install Java JDK 11+ |
| Tests fail with 404 | Check baseUrl in karate-config.js |
| Connection timeout | Increase timeout in karate-config.js |
| Cannot find feature files | Ensure files are in `src/test/resources/features/` |

---

## 📚 Resources

- [Karate Documentation](https://github.com/karatelabs/karate)
- [Karate Demo](https://github.com/karatelabs/karate/tree/master/karate-demo)
- Practice APIs: [JSONPlaceholder](https://jsonplaceholder.typicode.com/), [ReqRes](https://reqres.in/)

---

**Happy Testing! 🚀**
