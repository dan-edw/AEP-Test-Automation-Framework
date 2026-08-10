
package runners;

import com.intuit.karate.junit5.Karate;


/**
 * Main test runner for executing all Karate feature files
 * Run this class to execute all API tests
 */
public class TestRunner {
    
    /**
     * Runs all feature files - parallel execution is controlled by package.json scripts
     */
    @Karate.Test
    Karate testAll() {
        return Karate.run("classpath:features");
    }
}
