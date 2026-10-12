import { test, describe } from 'node:test'
import assert from 'node:assert'
import { getActivityType } from '../../src/common.js'

describe('getActivityType Unit Tests', () => {
  test('returns activity.type if present', () => {
    assert.strictEqual(getActivityType({ type: 'customType' }), 'customType')
  })

  test('infers type from oneof fields when type is missing', () => {
    assert.strictEqual(getActivityType({ agentMessaged: {} }), 'agentMessaged')
    assert.strictEqual(getActivityType({ userMessaged: {} }), 'userMessaged')
    assert.strictEqual(getActivityType({ planGenerated: {} }), 'planGenerated')
    assert.strictEqual(getActivityType({ planApproved: {} }), 'planApproved')
    assert.strictEqual(getActivityType({ progressUpdated: {} }), 'progressUpdated')
    assert.strictEqual(getActivityType({ sessionCompleted: {} }), 'sessionCompleted')
    assert.strictEqual(getActivityType({ sessionFailed: {} }), 'sessionFailed')
    assert.strictEqual(getActivityType({ artifacts: [] }), 'artifactsGenerated')
    assert.strictEqual(getActivityType({}), 'unknown')
  })
})
