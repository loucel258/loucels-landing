import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#050507",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            background:
              "radial-gradient(circle at 30% 30%, #00E5FF 0%, #6B4FFF 55%, #FF2D7A 100%)",
            boxShadow: "0 0 16px 2px rgba(0, 229, 255, 0.45)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
