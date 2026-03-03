#!/usr/bin/env node
import { randomUUID } from 'crypto'
import { initDatabase, createTask, getAllTasks, deleteTask, setTaskStatus } from './db.js'
import { computeNextRun } from './scheduler.js'

initDatabase()

const [, , cmd, ...args] = process.argv

function printHelp(): void {
  console.log(`
ClaudeClaw Schedule CLI

Commands:
  create "<prompt>" "<cron>" <chat_id>   Create a new scheduled task
  list                                    List all scheduled tasks
  delete <id>                             Delete a task
  pause <id>                              Pause a task
  resume <id>                             Resume a paused task

Cron examples:
  "0 9 * * *"     Daily at 9am
  "0 9 * * 1"     Every Monday at 9am
  "0 */4 * * *"   Every 4 hours
`)
}

switch (cmd) {
  case 'create': {
    const [prompt, cron, chatId] = args
    if (!prompt || !cron || !chatId) {
      console.error('Usage: schedule-cli create "<prompt>" "<cron>" <chat_id>')
      process.exit(1)
    }

    let nextRun: number
    try {
      nextRun = computeNextRun(cron)
    } catch {
      console.error(`Invalid cron expression: "${cron}"`)
      process.exit(1)
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    createTask({
      id,
      chat_id: chatId,
      prompt,
      schedule: cron,
      next_run: nextRun,
      status: 'active',
      created_at: now,
    })

    console.log(`Created task: ${id}`)
    console.log(`Next run: ${new Date(nextRun * 1000).toLocaleString()}`)
    break
  }

  case 'list': {
    const tasks = getAllTasks()
    if (tasks.length === 0) {
      console.log('No scheduled tasks.')
      break
    }
    console.log('\nScheduled Tasks:')
    console.log('─'.repeat(80))
    for (const t of tasks) {
      const nextRun = new Date(t.next_run * 1000).toLocaleString()
      const lastRun = t.last_run ? new Date(t.last_run * 1000).toLocaleString() : 'never'
      console.log(`ID:       ${t.id}`)
      console.log(`Prompt:   ${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? '...' : ''}`)
      console.log(`Schedule: ${t.schedule}`)
      console.log(`Status:   ${t.status}`)
      console.log(`Next run: ${nextRun}`)
      console.log(`Last run: ${lastRun}`)
      console.log('─'.repeat(80))
    }
    break
  }

  case 'delete': {
    const [id] = args
    if (!id) {
      console.error('Usage: schedule-cli delete <id>')
      process.exit(1)
    }
    deleteTask(id)
    console.log(`Deleted task: ${id}`)
    break
  }

  case 'pause': {
    const [id] = args
    if (!id) {
      console.error('Usage: schedule-cli pause <id>')
      process.exit(1)
    }
    setTaskStatus(id, 'paused')
    console.log(`Paused task: ${id}`)
    break
  }

  case 'resume': {
    const [id] = args
    if (!id) {
      console.error('Usage: schedule-cli resume <id>')
      process.exit(1)
    }
    setTaskStatus(id, 'active')
    console.log(`Resumed task: ${id}`)
    break
  }

  default:
    printHelp()
    break
}
