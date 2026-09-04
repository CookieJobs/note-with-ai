type TrendChartProps = {
  values: number[];
  label?: string;
};

export default function TrendChart({ values, label = '最近趋势' }: TrendChartProps) {
  const max = Math.max(1, ...values);
  const widthStep = 100 / Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => `${index * widthStep},${100 - (value / max) * 100}`)
    .join(' ');

  return (
    <figure>
      <svg viewBox="0 0 100 100" role="img" aria-label={label} width="100%" height="120">
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2" />
      </svg>
      <figcaption>趋势：{values.length ? values.join('、') : '暂无数据'}</figcaption>
    </figure>
  );
}
