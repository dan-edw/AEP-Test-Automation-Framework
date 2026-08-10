Feature: Tessera - Tessera Api Contract Testing (Auto-generated)
  This API transforms entity fact information into a format suitable for the UI
  
  Background:
    * url baseUrl
    * header Content-Type = 'application/json'

  Scenario Outline: GET /catalog/services - <testCase>
    Given path '/catalog/services'
    When method GET
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | param | expectedStatus |
      # TODO: Fill in actual test data
      | Success case      | 1 | 200 |

  Scenario Outline: GET /catalog/services/{serviceId}/contributions - <testCase>
    Given path '/catalog/services/', serviceId, '/contributions'
    When method GET
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | serviceId | expectedStatus |
      # TODO: Fill in actual test data
      | Success case      | component:evolve.aba-generator | 200 |

  Scenario Outline: GET /catalog/services/{serviceId}/health-check/results - <testCase>
    Given path '/catalog/services/', serviceId, '/health-check/results'
    When method GET
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | serviceId | expectedStatus |
      # TODO: Fill in actual test data
      | Success case      | component:evolve.aba-generator | 200 |

  Scenario Outline: GET /catalog/services/{serviceId} - <testCase>
    Given path '/catalog/services/', serviceId
    When method GET
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | serviceId | expectedStatus |
      # TODO: Fill in actual test data
      | Success case      | component:evolve.aba-generator | 200 |

  Scenario Outline: POST /catalog/services/{serviceId}/health-check/run - <testCase>
    Given path '/catalog/services/', serviceId, '/health-check/run'
    And request <requestBody>
    When method POST
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | serviceId | requestBody | expectedStatus |
      # TODO: Fill in actual request bodies and path params
      | Success case      | component:evolve.aba-generator | {} | 200 |

  Scenario Outline: GET /catalog/webartifacts - <testCase>
    Given path '/catalog/webartifacts'
    When method GET
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | param | expectedStatus |
      # TODO: Fill in actual test data
      | Success case      | 1 | 200 |

  Scenario Outline: GET /catalog/webartifacts/{webArtifactId} - <testCase>
    Given path '/catalog/webartifacts/', webArtifactId
    When method GET
    Then status <expectedStatus>
    # Add your custom validations here

    Examples:
      | testCase          | webArtifactId | expectedStatus |
      # TODO: Fill in actual test data
      | Success case      | component:evolve.adviser-simple-search | 200 |

