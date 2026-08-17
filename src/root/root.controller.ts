import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class RootController {
  @Public()
  @Get()
  @Header('Content-Type', 'text/html')
  root() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Goinzeschool API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 600px;
    }
    .logo {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 1.1rem;
      margin-bottom: 2rem;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 9999px;
      padding: 0.5rem 1.25rem;
      margin-bottom: 2rem;
    }
    .dot {
      width: 10px;
      height: 10px;
      background: #22c55e;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .info {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .info p {
      color: #94a3b8;
      margin-bottom: 0.75rem;
      font-size: 0.95rem;
    }
    .endpoint {
      font-family: 'SF Mono', 'Fira Code', monospace;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: #38bdf8;
      font-size: 0.9rem;
      word-break: break-all;
    }
    .footer {
      color: #475569;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">&#127891;</div>
    <h1>Goinzeschool API</h1>
    <p class="subtitle">Enterprise School Management ERP</p>
    <div class="status">
      <span class="dot"></span>
      <span>All systems operational</span>
    </div>
    <div class="info">
      <p>API base URL</p>
      <div class="endpoint">/api/v1</div>
    </div>
    <div class="info">
      <p>Health check</p>
      <div class="endpoint">/api/v1/health</div>
    </div>
    <p class="footer">Goinze International School &copy; ${new Date().getFullYear()}</p>
  </div>
</body>
</html>`;
  }
}
