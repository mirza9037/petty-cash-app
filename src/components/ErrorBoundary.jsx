import { Component } from 'react'
export default class ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <main className="app-message" role="alert">
        <h1>Something went wrong</h1>
        <p>Reload to recover. Unsaved changes may need to be entered again.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    )
  }
}
