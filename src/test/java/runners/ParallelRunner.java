package runners;

import com.intuit.karate.Results;
import com.intuit.karate.Runner;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

/**
 * Parallel test runner - executes scenarios in parallel
 */
public class ParallelRunner {
    
    @Test
    void testParallel() {
        Results results = Runner.path("classpath:features")
                .parallel(3); // 3 parallel threads
        
        assertEquals(0, results.getFailCount(), results.getErrorMessages());
    }
}
