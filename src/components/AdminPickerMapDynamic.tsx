"use client";

import dynamic from "next/dynamic";

type Props = {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
  height?: number;
};

const AdminPickerMapDynamic = dynamic<Props>(
  () => import("./AdminPickerMap").then((m) => m.default),
  { ssr: false }
);

export default AdminPickerMapDynamic;
