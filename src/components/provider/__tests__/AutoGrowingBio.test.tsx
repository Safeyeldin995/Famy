import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutoGrowingBio } from "../AutoGrowingBio";
afterEach(cleanup);
it("grows and shrinks for edited text or inserted phrases without saving implicitly", () => {
  const onChange = vi.fn();
  const { rerender } = render(<AutoGrowingBio value="Short bio" onChange={onChange} />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(field.style.height).toBe("112px");
  Object.defineProperty(field, "scrollHeight", { configurable: true, value: 260 });
  rerender(<AutoGrowingBio value="Long bio and an inserted phrase" onChange={onChange} />);
  expect(field.style.height).toBe("260px");
  Object.defineProperty(field, "scrollHeight", { configurable: true, value: 70 });
  rerender(<AutoGrowingBio value="Short" onChange={onChange} />);
  expect(field.style.height).toBe("112px");
  fireEvent.change(field, { target: { value: "Edited" } });
  expect(onChange).toHaveBeenCalledWith("Edited");
  expect(onChange).toHaveBeenCalledTimes(1);
});
