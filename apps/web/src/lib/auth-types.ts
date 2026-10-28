/** State returned by the login server action to the login form. */
export type LoginState = {
  error?: string
  /** Echoed back so the form keeps what the user typed. */
  email?: string
}

/** What the UI shows about the signed-in user (from the assist.users profile). */
export type SessionProfile = {
  userId: string
  name: string
  email: string
  role: 'employee' | 'analyst'
  department: string
  team?: string
}
