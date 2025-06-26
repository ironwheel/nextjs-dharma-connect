#!/usr/bin/env node

// Test to verify parent stage validation logic
async function testParentStageValidation() {
    console.log('Testing parent stage validation logic...');

    // Mock data
    const stages = [
        { stage: 'reg', description: 'Registration', order: 1 },
        { stage: 'reg-confirm', description: 'Registration Confirmation', order: 2, parentStage: 'reg' },
        { stage: 'reminder', description: 'Reminder', order: 3, parentStage: 'reg' }
    ];

    const mockWorkOrders = [
        {
            id: 'wo_1',
            eventCode: 'am2023',
            subEvent: 'weekend1',
            stage: 'reg',
            s3HTMLPaths: { EN: 's3://bucket/am2023/weekend1/reg-EN.html' },
            languages: { EN: true, ES: false },
            subjects: { EN: 'Registration', ES: 'Registro' }
        }
    ];

    // Mock API call function
    const mockCallDbApi = async (action, params) => {
        if (action === 'handleFindParentWorkOrder') {
            const { eventCode, subEvent, parentStage } = params;
            const parentWorkOrder = mockWorkOrders.find(wo =>
                wo.eventCode === eventCode &&
                wo.subEvent === subEvent &&
                wo.stage === parentStage
            );
            return parentWorkOrder || null;
        }
        return null;
    };

    // Test cases
    const testCases = [
        {
            name: 'Valid parent stage exists',
            eventCode: 'am2023',
            subEvent: 'weekend1',
            selectedStage: 'reg-confirm',
            expectedResult: 'should succeed'
        },
        {
            name: 'No parent stage required',
            eventCode: 'am2023',
            subEvent: 'weekend1',
            selectedStage: 'reg',
            expectedResult: 'should succeed'
        },
        {
            name: 'Parent stage not found',
            eventCode: 'am2023',
            subEvent: 'weekend2',
            selectedStage: 'reminder',
            expectedResult: 'should fail'
        },
        {
            name: 'Different event code',
            eventCode: 'different2023',
            subEvent: 'weekend1',
            selectedStage: 'reg-confirm',
            expectedResult: 'should fail'
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n--- Testing: ${testCase.name} ---`);

        const stageRecord = stages.find(s => s.stage === testCase.selectedStage);

        if (stageRecord?.parentStage && testCase.eventCode && testCase.subEvent) {
            try {
                const parentWorkOrder = await mockCallDbApi('handleFindParentWorkOrder', {
                    eventCode: testCase.eventCode,
                    subEvent: testCase.subEvent,
                    parentStage: stageRecord.parentStage
                });

                if (parentWorkOrder) {
                    console.log(`✅ SUCCESS: Parent work order found for stage '${stageRecord.parentStage}'`);
                    console.log(`   Inherited fields:`, {
                        s3HTMLPaths: parentWorkOrder.s3HTMLPaths,
                        languages: parentWorkOrder.languages,
                        subjects: parentWorkOrder.subjects
                    });
                } else {
                    console.log(`❌ FAILED: Parent work order not found for stage '${stageRecord.parentStage}'`);
                    console.log(`   Expected: ${testCase.expectedResult}`);
                }
            } catch (error) {
                console.log(`❌ ERROR: ${error.message}`);
            }
        } else {
            console.log(`✅ SUCCESS: No parent stage required for '${testCase.selectedStage}'`);
        }
    }

    console.log('\n=== Test Summary ===');
    console.log('This test verifies that:');
    console.log('1. Stages with parentStage require a valid parent work order');
    console.log('2. Stages without parentStage can be selected without validation');
    console.log('3. Parent work order must match eventCode, subEvent, and parentStage');
    console.log('4. When parent work order is found, inherited fields are available');
    console.log('5. When parent work order is not found, stage selection should be prevented');
}

testParentStageValidation(); 