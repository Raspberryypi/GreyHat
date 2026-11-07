import { describe, expect, it } from 'vitest';
import { ParseError, parse, tokenize } from './parser';

describe('tokenizer', () => {
  it('keeps quoted text together and remembers quoting', () => {
    const t = tokenize(`echo "a b" 'c d' e`);
    const words = t.filter((x) => x.type === 'word');
    expect(words).toHaveLength(4);
    if (words[1].type === 'word') expect(words[1].word[0]).toEqual({ text: 'a b', quote: 'double' });
    if (words[2].type === 'word') expect(words[2].word[0]).toEqual({ text: 'c d', quote: 'single' });
  });

  it('treats 2> as a stderr redirect but "2" as an argument', () => {
    const a = tokenize('find / 2>/dev/null');
    expect(a.some((t) => t.type === 'redir' && t.fd === 2 && t.op === '>')).toBe(true);
    const b = tokenize('echo 2 > f');
    expect(b.some((t) => t.type === 'redir' && t.fd === 1)).toBe(true);
  });

  it('recognises 2>&1', () => {
    expect(tokenize('ls x 2>&1').some((t) => t.type === 'redir' && t.op === 'dup')).toBe(true);
  });
});

describe('parser', () => {
  it('builds pipelines', () => {
    const items = parse('cat a | grep b | wc -l');
    expect(items).toHaveLength(1);
    expect(items[0].pipeline.commands).toHaveLength(3);
  });

  it('splits lists on && || ;', () => {
    const items = parse('a && b || c ; d');
    expect(items.map((i) => i.connector)).toEqual(['&&', '||', ';', null]);
  });

  it('attaches redirects to the right command', () => {
    const items = parse('echo hi > out.txt');
    const cmd = items[0].pipeline.commands[0];
    expect(cmd.words).toHaveLength(2);
    expect(cmd.redirects).toHaveLength(1);
  });

  it('rejects malformed input', () => {
    expect(() => parse('ls |')).toThrow(ParseError);
    expect(() => parse("echo 'oops")).toThrow(ParseError);
    expect(() => parse('&& ls')).toThrow(ParseError);
    expect(() => parse('echo hi >')).toThrow(ParseError);
  });

  it('allows a trailing semicolon and empty input', () => {
    expect(parse('ls;')).toHaveLength(1);
    expect(parse('   ')).toHaveLength(0);
    expect(parse('# just a comment')).toHaveLength(0);
  });
});
