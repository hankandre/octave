// T17-01 item 1: the web form's root, written in React DOM, draws the placeholder heading.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./app";

describe("the web form's root", () => {
  it("draws one level-one heading, Octave", () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1[^>]*>Octave<\/h1>/);
  });
});
