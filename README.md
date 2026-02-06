# @attensira/analytics

Page-hit tracking for [Attensira](https://attensira.com).

## Install

```bash
npm install @attensira/analytics
```

## Usage

```ts
import { trackPageHit } from '@attensira/analytics';

trackPageHit('YOUR_PROJECT_ID');
```

### React

```tsx
import { Attensira } from '@attensira/analytics/react';

function App() {
  return <Attensira projectId="YOUR_PROJECT_ID" />;
}
```
