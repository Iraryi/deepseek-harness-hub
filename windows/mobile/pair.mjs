const token = location.hash.slice(1)
history.replaceState(null, '', location.pathname)
const form = document.querySelector('#pair')
const submit = document.querySelector('#submit')
const status = document.querySelector('#status')
const valid = /^[A-Za-z0-9_-]{43}$/.test(token)
submit.disabled = !valid
if (!valid) status.textContent = 'Create a fresh pairing link on the computer. / 请在电脑端生成新的配对链接。'
form.addEventListener('submit', async event => {
  event.preventDefault()
  if (!valid || submit.disabled) return
  submit.disabled = true
  status.textContent = 'Pairing… / 正在配对…'
  try {
    const response = await fetch('/__mobile/pair', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: token, name: document.querySelector('#name').value, consent: document.querySelector('#consent').checked }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Pairing denied or expired. Create a new link on the computer. / 配对被拒绝或已过期，请在电脑端生成新链接。')
    location.replace('/')
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' ? 'Connection timed out. Check Wi-Fi and request a new link. / 连接超时，请检查 Wi-Fi 并重新获取链接。' : error.message
    submit.disabled = false
  }
})
