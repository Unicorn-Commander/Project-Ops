import { parseMentions } from './mention.util';

describe('parseMentions', () => {
  it('returns empty for null/empty/no-mention content', () => {
    for (const c of [null, undefined, '', 'no mentions here', 'email a@b.com without @'] as any[]) {
      expect(parseMentions(c).all).toEqual([]);
    }
  });

  it('parses a single @username', () => {
    const r = parseMentions('hey @aaron can you look at this');
    expect(r.usernames).toEqual(['aaron']);
    expect(r.emails).toEqual([]);
    expect(r.all).toEqual(['aaron']);
  });

  it('parses an @email and keeps the full address (not truncated at @)', () => {
    const r = parseMentions('ping @aaron@magicunicorn.tech please');
    expect(r.emails).toEqual(['aaron@magicunicorn.tech']);
    expect(r.usernames).toEqual([]);
  });

  it('parses multiple mixed handles and dedupes (case-insensitive)', () => {
    const r = parseMentions('@bob @Bob @alice @bob@x.com @bob@x.com');
    expect(r.usernames.sort()).toEqual(['alice', 'bob']);
    expect(r.emails).toEqual(['bob@x.com']);
    expect(r.all.sort()).toEqual(['alice', 'bob', 'bob@x.com']);
  });

  it('supports dot/underscore/hyphen usernames', () => {
    expect(parseMentions('@a.b @c_d @e-f').usernames.sort()).toEqual(['a.b', 'c_d', 'e-f']);
  });

  it('strips trailing sentence punctuation', () => {
    expect(parseMentions('thanks @aaron!').usernames).toEqual(['aaron']);
    expect(parseMentions('cc @bob, @carol.').usernames.sort()).toEqual(['bob', 'carol']);
  });

  it('does NOT match an @ in the middle of a word (an inline email host)', () => {
    // "reach me at bob@host.com" — the "@host.com" must not become a username,
    // and the bare token before it isn't a mention either.
    const r = parseMentions('reach me at bob@host.com');
    expect(r.all).toEqual([]);
  });

  it('matches a mention at the very start of the string', () => {
    expect(parseMentions('@lead heads up').usernames).toEqual(['lead']);
  });

  it('matches mentions after punctuation boundaries', () => {
    expect(parseMentions('(@bob) and [@carol]').usernames.sort()).toEqual(['bob', 'carol']);
  });
});
