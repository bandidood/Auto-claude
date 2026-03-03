import pkg from 'cron-parser'
const { parseExpression } = pkg as any
import { getDueTasks, updateTaskAfterRun } from './db.js'
import { runAgent } from './agent.js'
import { logger } from './logger.js'

export type Sender = (chatId: string, text: string) => Promise<void>

let schedulerInterval: ReturnType<typeof setInterval> | null = null

export function computeNextRun(cronExpression: string): number {
  const interval = parseExpression(cronExpression)
  return Math.floor(interval.next().toDate().getTime() / 1000)
}

export async function runDueTasks(send: Sender): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const tasks = getDueTasks(now)

  for (const task of tasks) {
    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Running scheduled task')

    try {
      await send(task.chat_id, `Running scheduled task: "${task.prompt.slice(0, 80)}"...`)
      const { text } = await runAgent(task.prompt)
      const result = text ?? '(no response)'

      const nextRun = computeNextRun(task.schedule)
      updateTaskAfterRun(task.id, result, nextRun)

      await send(task.chat_id, `Scheduled task result:\n\n${result}`)
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Scheduled task failed')
      const nextRun = computeNextRun(task.schedule)
      updateTaskAfterRun(task.id, `Error: ${String(err)}`, nextRun)
      await send(task.chat_id, `Scheduled task failed: ${String(err)}`)
    }
  }
}

export function initScheduler(send: Sender): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
  }

  // Run immediately in case tasks are due on startup
  runDueTasks(send).catch(err => logger.error({ err }, 'Scheduler startup run failed'))

  schedulerInterval = setInterval(() => {
    runDueTasks(send).catch(err => logger.error({ err }, 'Scheduler poll failed'))
  }, 60 * 1000)

  logger.info('Scheduler started (polling every 60s)')
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}
