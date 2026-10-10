// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Avatar, initialsOf, ThemeToggle } from './index';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

test('the theme toggle switches between light and dark and remembers it', () => {
  render(<ThemeToggle />);
  const button = screen.getByRole('button', { name: /tema claro e escuro/i });
  fireEvent.click(button);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('malphas-theme')).toBe('dark');
  fireEvent.click(button);
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('malphas-theme')).toBe('light');
});

test('the avatar shows the initials of the name', () => {
  expect(initialsOf('Lincoln Giacomini Santos')).toBe('LS');
  expect(initialsOf('lincoln')).toBe('L');
  expect(initialsOf('')).toBe('?');
  render(<Avatar initials="LS" label="Lincoln" />);
  expect(screen.getByText('LS')).toBeTruthy();
});
