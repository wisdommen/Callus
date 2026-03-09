import { readFileSync, writeFileSync } from 'fs';

export class SignalStore {
  constructor(signalsPath) {
    this.path = signalsPath;
  }

  load() {
    return JSON.parse(readFileSync(this.path, 'utf-8'));
  }

  save(data) {
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  appendSignal(signal) {
    const data = this.load();
    data.signals.push(signal);
    this.save(data);
  }

  appendSelfReview(review) {
    const data = this.load();
    data.self_reviews.push(review);
    this.save(data);
  }

  /**
   * Aggregate signals by topic within a time window.
   * Returns: { [topic]: { total_severity, session_count, signal_count, signals, self_reviews } }
   */
  aggregateByTopic(windowDays) {
    const data = this.load();
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const result = {};

    for (const sig of data.signals) {
      if (new Date(sig.timestamp) < cutoff) continue;

      if (!result[sig.topic]) {
        result[sig.topic] = {
          total_severity: 0,
          sessions: new Set(),
          signal_count: 0,
          signals: [],
          self_reviews: []
        };
      }
      const entry = result[sig.topic];
      entry.total_severity += sig.severity;
      entry.sessions.add(sig.session_id);
      entry.signal_count++;
      entry.signals.push(sig);
    }

    // Attach self-reviews to topics
    for (const review of data.self_reviews) {
      if (new Date(review.timestamp) < cutoff) continue;
      const topics = new Set();
      for (const s of (review.struggles || [])) topics.add(s.topic);
      for (const w of (review.wins || [])) topics.add(w.topic);

      for (const topic of topics) {
        if (result[topic]) {
          result[topic].self_reviews.push(review);
        }
      }
    }

    // Convert Sets to counts
    for (const topic of Object.keys(result)) {
      result[topic].session_count = result[topic].sessions.size;
      delete result[topic].sessions;
    }

    return result;
  }
}
