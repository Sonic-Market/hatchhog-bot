import chalk, {ChalkInstance} from "chalk";
import {sendSlackErrorMessage, sendSlackInfoMessage} from "./slack.ts";

const log = (
  message: string,
  value: any,
  level: 'debug' | 'info' | 'warn' | 'error',
  sendMessageToSlack = false,
) => {
  try {
    let color: ChalkInstance
    if (level === 'error') {
      color = chalk.red
    } else if (level === 'warn') {
      color = chalk.yellow
    } else if (level === 'info') {
      color = chalk.green
    } else {
      color = chalk.blue
    }
    console.log(
      color(
        `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}]`,
        message,
        JSON.stringify(value),
      ),
    )

    const messageWithValue = {
      message,
      level,
      ...value,
    }

    if (sendMessageToSlack) {
      if (level === 'error' || level === 'warn') {
        sendSlackErrorMessage(messageWithValue)
      } else {
        sendSlackInfoMessage(messageWithValue)
      }
    }
  } catch (e) {
    console.error('Error in logger', e)
  }
}

class Logger {
  debug(message: string, value: any, sendMessageToSlack = false) {
    log(message, value, 'debug', sendMessageToSlack)
  }

  info(message: string, value: any, sendMessageToSlack = false) {
    log(message, value, 'info', sendMessageToSlack)
  }

  warn(message: string, value: any, sendMessageToSlack = false) {
    log(message, value, 'warn', sendMessageToSlack)
  }

  error(message: string, value: any, sendMessageToSlack = true) {
    log(message, value, 'error', sendMessageToSlack)
  }
}

export const logger = new Logger()
