import { describe, it, expect } from 'vitest';
import { getChannel } from '../../../src/notification/channel-registry.js';
import { InAppChannel } from '../../../src/notification/channels/in-app.js';
import { EmailChannel } from '../../../src/notification/channels/email.js';

describe('getChannel', () => {
  it('returns InAppChannel for in_app', () => {
    const channel = getChannel('in_app');
    expect(channel).toBeInstanceOf(InAppChannel);
    expect(channel?.type).toBe('in_app');
  });

  it('returns EmailChannel for email', () => {
    const channel = getChannel('email');
    expect(channel).toBeInstanceOf(EmailChannel);
    expect(channel?.type).toBe('email');
  });

  it('returns null for unknown types (teams, slack, xyz)', () => {
    expect(getChannel('teams')).toBeNull();
    expect(getChannel('slack')).toBeNull();
    expect(getChannel('xyz')).toBeNull();
  });
});
