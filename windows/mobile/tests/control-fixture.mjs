import { MobileRelay, runControl } from '../relay.mjs'

runControl(new MobileRelay({ allowLoopbackForTests: true }))
