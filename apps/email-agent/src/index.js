import { config } from 'dotenv'
import { logger } from './logger.js'
import { WorkOrderProcessor } from './work-order-processor.js'

// Load environment variables
config()

async function main() {
    try {
        logger.info('Starting email agent...')

        const processor = new WorkOrderProcessor()
        await processor.start()

        // Handle graceful shutdown
        process.on('SIGTERM', async () => {
            logger.info('Received SIGTERM. Shutting down...')
            await processor.stop()
            process.exit(0)
        })

        process.on('SIGINT', async () => {
            logger.info('Received SIGINT. Shutting down...')
            await processor.stop()
            process.exit(0)
        })
    } catch (error) {
        logger.error('Fatal error:', error)
        process.exit(1)
    }
}

main() 