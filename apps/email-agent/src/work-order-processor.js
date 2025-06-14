import { logger } from './logger.js'
import { callDbApi } from '@dharma/backend-core'
import { StepProcessor } from './step-processor.js'

export class WorkOrderProcessor {
    constructor() {
        this.isRunning = false
        this.pollInterval = 5000 // 5 seconds
        this.pollTimer = null
        this.currentWorkOrder = null
        this.stepProcessor = new StepProcessor()
    }

    async start() {
        if (this.isRunning) {
            logger.warn('WorkOrderProcessor is already running')
            return
        }

        this.isRunning = true
        logger.info('Starting work order processor')
        await this.poll()
    }

    async stop() {
        if (!this.isRunning) {
            return
        }

        this.isRunning = false
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
            this.pollTimer = null
        }

        // If there's a current work order, mark it as stopped
        if (this.currentWorkOrder) {
            try {
                await this.updateWorkOrderStatus(this.currentWorkOrder.workOrderId, 'stopped')
            } catch (error) {
                logger.error('Error stopping current work order:', error)
            }
        }

        logger.info('Work order processor stopped')
    }

    async poll() {
        if (!this.isRunning) {
            return
        }

        try {
            // Only look for new work orders if we're not processing one
            if (!this.currentWorkOrder) {
                const workOrders = await callDbApi('getWorkOrders', { status: 'pending' })
                if (workOrders && workOrders.length > 0) {
                    this.currentWorkOrder = workOrders[0]
                    logger.info('Found new work order:', { workOrderId: this.currentWorkOrder.workOrderId })
                    await this.processWorkOrder()
                }
            }

            // Schedule next poll
            this.pollTimer = setTimeout(() => this.poll(), this.pollInterval)
        } catch (error) {
            logger.error('Error in poll cycle:', error)
            // Schedule next poll even if there was an error
            this.pollTimer = setTimeout(() => this.poll(), this.pollInterval)
        }
    }

    async processWorkOrder() {
        const { workOrderId, steps } = this.currentWorkOrder

        try {
            // Mark work order as running
            await this.updateWorkOrderStatus(workOrderId, 'running')

            // Process each step in sequence
            for (const step of steps) {
                if (!this.isRunning) {
                    logger.info('Work order processor stopped, aborting step processing')
                    return
                }

                await this.processStep(workOrderId, step)
            }

            // All steps completed successfully
            await this.updateWorkOrderStatus(workOrderId, 'completed')
        } catch (error) {
            logger.error('Error processing work order:', error)
            await this.updateWorkOrderStatus(workOrderId, 'error', error.message)
        } finally {
            this.currentWorkOrder = null
        }
    }

    async processStep(workOrderId, step) {
        const { stepNumber, status, continuous } = step

        try {
            // Skip if step is already completed
            if (status === 'completed') {
                return
            }

            // Update step status to running
            await this.updateStepStatus(workOrderId, stepNumber, 'running')

            // Process the step
            await this.stepProcessor.processStep(workOrderId, step)

            // If step is continuous, don't mark it as completed
            if (!continuous) {
                await this.updateStepStatus(workOrderId, stepNumber, 'completed')
            }
        } catch (error) {
            logger.error(`Error processing step ${stepNumber}:`, error)
            await this.updateStepStatus(workOrderId, stepNumber, 'error', error.message)
            throw error // Re-throw to stop work order processing
        }
    }

    async updateWorkOrderStatus(workOrderId, status, errorMessage = null) {
        const updates = { status }
        if (errorMessage) {
            updates.errorMessage = errorMessage
        }

        await callDbApi('updateWorkOrder', {
            workOrderId,
            userPid: 'system',
            updates
        })
    }

    async updateStepStatus(workOrderId, stepNumber, status, errorMessage = null) {
        const workOrder = await callDbApi('getWorkOrder', { workOrderId })
        const steps = workOrder.steps.map(step => {
            if (step.stepNumber === stepNumber) {
                return {
                    ...step,
                    status,
                    errorMessage,
                    startTime: status === 'running' ? new Date().toISOString() : step.startTime,
                    endTime: ['completed', 'error'].includes(status) ? new Date().toISOString() : step.endTime
                }
            }
            return step
        })

        await callDbApi('updateWorkOrder', {
            workOrderId,
            userPid: 'system',
            updates: { steps }
        })
    }
} 