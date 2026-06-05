import { supabase } from './supabaseClient.js'

// ── Auth State ────────────────────────────────────────────────────────────────
export let currentUser = null

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  currentUser = session?.user ?? null
  updateNavForAuth()

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null
    updateNavForAuth()
  })
}

function updateNavForAuth() {
  const authBtn = document.getElementById('nav-auth-btn')
  const dashBtn = document.getElementById('nav-dashboard-btn')
  if (!authBtn) return
  if (currentUser) {
    authBtn.textContent = 'Log Out'
    authBtn.onclick = signOut
    if (dashBtn) dashBtn.style.display = 'inline-flex'
  } else {
    authBtn.textContent = 'Log In'
    authBtn.onclick = () => window.showPage('login')
    if (dashBtn) dashBtn.style.display = 'none'
  }
}

export async function signOut() {
  await supabase.auth.signOut()
  window.showPage('home')
}

// ── Sign Up ───────────────────────────────────────────────────────────────────
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data.user
}

// ── Sign In ───────────────────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user
}
