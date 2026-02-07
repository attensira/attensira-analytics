# @attensira/analytics

Page-hit tracking for [Attensira](https://attensira.com).

## Install

```bash
npm install @attensira/analytics
```

## Usage

### React

```tsx
import { AttensiraAnalytics } from '@attensira/analytics';

function App() {
  return <AttensiraAnalytics projectId="YOUR_PROJECT_ID" />;
}
```

### Vanilla JS

```ts
import { trackPageHit } from '@attensira/analytics';

trackPageHit('YOUR_PROJECT_ID');
```
