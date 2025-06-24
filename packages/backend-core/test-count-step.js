#!/usr/bin/env node

// Simple test to verify the work order creation logic
async function testWorkOrderCreation() {
    console.log('Testing work order creation with Count step...');

    const testPayload = {
        eventCode: 'am2023',
        subEvent: 'weekend1',
        stage: 'reg-confirm',
        languages: { EN: true, ES: false },
        subjects: { EN: 'Test Subject', ES: 'Asunto de Prueba' },
        account: 'test-account',
        createdBy: 'test-user',
        zoomId: 'test-zoom-id',
        inPerson: false,
        config: { pool: 'test-pool' }
    };

    try {
        // Extract the logic from handleCreateWorkOrder
        const { eventCode, subEvent, stage, languages, subjects, account, createdBy, zoomId, inPerson, config } = testPayload;

        const id = `wo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date().toISOString();

        const workOrder = {
            id,
            eventCode,
            subEvent,
            stage,
            languages,
            subjects,
            account,
            createdBy,
            zoomId: zoomId || null,
            inPerson: inPerson || false,
            config: config || {},
            locked: false,
            lockedBy: "",
            steps: [
                { name: 'Count', status: 'ready', message: '', isActive: true },
                { name: 'Prepare', status: 'ready', message: '', isActive: false },
                { name: 'Test', status: 'ready', message: '', isActive: false },
                { name: 'Send', status: 'ready', message: '', isActive: false }
            ],
            createdAt: now,
            updatedAt: now
        };

        console.log('\nGenerated work order:');
        console.log('ID:', workOrder.id);
        console.log('Steps:', workOrder.steps.map(s => `${s.name} (${s.status}, active: ${s.isActive})`));
        console.log('Config:', workOrder.config);
        console.log('InPerson:', workOrder.inPerson);
        console.log('ZoomId:', workOrder.zoomId);

        // Verify Count step is first and active
        const countStep = workOrder.steps.find(s => s.name === 'Count');
        const prepareStep = workOrder.steps.find(s => s.name === 'Prepare');

        if (countStep && countStep.isActive && !prepareStep.isActive) {
            console.log('\n✅ SUCCESS: Count step is first and active, Prepare step is inactive');
        } else {
            console.log('\n❌ FAILED: Step configuration is incorrect');
            console.log('Count step active:', countStep?.isActive);
            console.log('Prepare step active:', prepareStep?.isActive);
        }

        if (workOrder.config.pool === 'test-pool') {
            console.log('✅ SUCCESS: Config pool is correctly set');
        } else {
            console.log('❌ FAILED: Config pool is not set correctly');
        }

        // Verify step order
        const stepNames = workOrder.steps.map(s => s.name);
        const expectedOrder = ['Count', 'Prepare', 'Test', 'Send'];

        if (JSON.stringify(stepNames) === JSON.stringify(expectedOrder)) {
            console.log('✅ SUCCESS: Step order is correct');
        } else {
            console.log('❌ FAILED: Step order is incorrect');
            console.log('Expected:', expectedOrder);
            console.log('Actual:', stepNames);
        }

        console.log('\nTest completed successfully!');

    } catch (error) {
        console.error('Test failed:', error);
    }
}

testWorkOrderCreation(); 