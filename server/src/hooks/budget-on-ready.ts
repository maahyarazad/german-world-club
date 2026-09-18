import { assertBudgets } from '../config/budgets.ts'

/**
 * The budget gate. Runs after every route is registered, alongside the
 * route-posture gate in 11-rbac.js — both must pass for the process to serve
 * traffic at all.
 */
export function registerBudgetGate(app, env) {
  app.addHook('onReady', async () => {
    assertBudgets(env.REQUEST_TIMEOUT_MS)
  })
}
