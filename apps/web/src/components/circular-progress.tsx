import { cn } from "@/lib/utils";
import { getBenchmarkColor } from "@/lib/benchmark-formatting";

interface CircularProgressProps {
	value: number | null;
	size?: number;
	strokeWidth?: number;
	className?: string;
}

export function CircularProgress({
	value,
	size = 48,
	strokeWidth = 3,
	className,
}: CircularProgressProps) {
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const center = size / 2;

	const colorClass = getBenchmarkColor(value);
	const fontSize = Math.round((10 / 48) * size);

	if (value === null) {
		return (
			<svg
				width={size}
				height={size}
				viewBox={`0 0 ${size} ${size}`}
				className={cn("shrink-0", className)}
			>
				<circle
					cx={center}
					cy={center}
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth={strokeWidth}
					strokeDasharray="4 4"
					className="text-muted-foreground/20"
				/>
				<text
					x={center}
					y={center}
					textAnchor="middle"
					dominantBaseline="central"
					className="fill-muted-foreground font-semibold"
					style={{ fontSize: `${fontSize}px` }}
				>
					N/A
				</text>
			</svg>
		);
	}

	const clampedValue = Math.min(100, Math.max(0, value));
	const dashoffset = circumference * (1 - clampedValue / 100);

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			className={cn("shrink-0", className)}
		>
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				className="text-muted-foreground/20"
			/>
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="none"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				stroke="currentColor"
				strokeDasharray={circumference}
				strokeDashoffset={dashoffset}
				transform={`rotate(-90 ${center} ${center})`}
				className={colorClass}
				style={{
					transition: "stroke-dashoffset 0.6s ease-out",
				}}
			/>
			<text
				x={center}
				y={center}
				textAnchor="middle"
				dominantBaseline="central"
				className={cn("font-semibold", colorClass.replace("text-", "fill-"))}
				style={{ fontSize: `${fontSize}px` }}
			>
				{`${Math.round(clampedValue)}%`}
			</text>
		</svg>
	);
}
