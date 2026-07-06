import React, { Component, type ReactNode } from 'react'

interface Props {
    children: ReactNode
    fallback?: ReactNode
}

interface State {
    hasError: boolean
    error?: Error
}

/**
 * Error boundary component that catches JavaScript errors in child components.
 * Displays a fallback UI instead of crashing the entire app.
 */
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo.componentStack)
    }

    handleReload = () => {
        location.reload()
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback
            }
            return (
                <div style={{ padding: 32, textAlign: 'center' }}>
                    <h2>Something went wrong</h2>
                    <p style={{ color: '#888', marginBottom: 16 }}>
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button onClick={this.handleReload}>Reload Page</button>
                </div>
            )
        }
        return this.props.children
    }
}
