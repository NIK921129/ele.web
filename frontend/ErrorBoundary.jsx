import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error Boundary caught:', error, errorInfo);
    
    // Log to external service in production
    if (import.meta.env.PROD) {
      // TODO: Send to Sentry, LogRocket, etc.
      console.error('Production error:', { error, errorInfo });
    }
    
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  handleClearCache = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch(e) {}
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '40px 20px',
          textAlign: 'center',
          background: 'var(--surface)',
          color: 'var(--text-main)'
        }}>
          <div style={{
            background: 'var(--danger)',
            color: 'white',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
            fontSize: '2.5rem'
          }}>
            <i className="fas fa-exclamation-triangle"></i>
          </div>
          
          <h1 style={{ fontSize: '2rem', marginBottom: '16px', fontWeight: 700 }}>
            Oops! Something went wrong
          </h1>
          
          <p style={{ 
            color: 'var(--text-muted)', 
            marginBottom: '32px', 
            maxWidth: '500px',
            fontSize: '1.1rem'
          }}>
            We're sorry for the inconvenience. The application encountered an unexpected error.
          </p>

          {import.meta.env.DEV && this.state.error && (
            <details style={{
              background: 'var(--secondary)',
              padding: '16px',
              borderRadius: '12px',
              marginBottom: '24px',
              maxWidth: '600px',
              width: '100%',
              textAlign: 'left',
              border: '1px solid var(--border-light)'
            }}>
              <summary style={{ 
                cursor: 'pointer', 
                fontWeight: 600,
                marginBottom: '12px',
                color: 'var(--danger)'
              }}>
                Error Details (Development Only)
              </summary>
              <pre style={{
                fontSize: '0.85rem',
                overflow: 'auto',
                background: 'var(--surface)',
                padding: '12px',
                borderRadius: '8px',
                color: 'var(--text-main)'
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo && '\n\n' + this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button 
              onClick={this.handleReload}
              className="btn"
              style={{
                padding: '14px 28px',
                fontSize: '1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <i className="fas fa-sync"></i>
              Reload Page
            </button>
            
            <button 
              onClick={this.handleGoHome}
              className="btn-outline"
              style={{
                padding: '14px 28px',
                fontSize: '1rem',
                background: 'transparent',
                color: 'var(--text-main)',
                border: '2px solid var(--border-light)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <i className="fas fa-home"></i>
              Go Home
            </button>
            
            <button 
              onClick={this.handleClearCache}
              className="btn-outline"
              style={{
                padding: '14px 28px',
                fontSize: '1rem',
                background: 'transparent',
                color: 'var(--danger)',
                border: '2px solid var(--danger)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <i className="fas fa-trash-alt" style={{ marginRight: '8px' }}></i> Clear App Data & Restart
            </button>
          </div>

          <p style={{ 
            marginTop: '32px', 
            fontSize: '0.9rem', 
            color: 'var(--text-muted)' 
          }}>
            If this problem persists, please contact support.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
