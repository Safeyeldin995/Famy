import { BottomSheetSelect } from "./BottomSheetSelect";
import "./customerForms.css";

/** Reuse the booking picker without changing filter values or selection semantics. */
export function CustomerFilterPicker({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div id={id} className="apply-ui customer-filter-picker min-w-0">
      <BottomSheetSelect label={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}
