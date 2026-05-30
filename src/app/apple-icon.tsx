import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#050507",
          borderRadius: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 999,
            background:
              "radial-gradient(circle at 30% 30%, #00E5FF 0%, #6B4FFF 55%, #FF2D7A 100%)",
            boxShadow: "0 0 50px 4px rgba(0, 229, 255, 0.45)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
