async function sendMessage(type: 'info' | 'error', message: any) {
  const url =
    type === 'info'
      ? (process.env.SLACK_INFO_HOOKS_URL as string)
      : (process.env.SLACK_ERROR_HOOKS_URL as string)
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: '```\n[hatchhog-bot]\n' + JSON.stringify(message, null, 2) + '\n```',
    }),
  })
}

export async function sendSlackInfoMessage(message: any) {
  await sendMessage('info', message)
}

export async function sendSlackErrorMessage(message: any) {
  await sendMessage('error', message)
}
