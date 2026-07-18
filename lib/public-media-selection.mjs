export const PUBLIC_GALLERY_MEDIA = Object.freeze([
  Object.freeze({ name: "DSC08186.jpg", alt: "Visitors gathering on the beach at Texas SandFest" }),
  Object.freeze({ name: "DSC07846.jpg", alt: "Texas SandFest, United States, and Texas flags above the beach" }),
  Object.freeze({ name: "DSC08716.jpg", alt: "Children learning to sculpt sand at Texas SandFest" }),
  Object.freeze({ name: "DSC07802.jpg", alt: "Festival food service prepared for Texas SandFest guests" }),
  Object.freeze({ name: "DSC08548.jpg", alt: "A guitarist performing live on the Texas SandFest stage" }),
  Object.freeze({ name: "DSC08541.jpg", alt: "A couple dancing in the crowd at Texas SandFest" }),
  Object.freeze({ name: "DSC00673_edited.jpg", alt: "Guests arriving beneath the Texas SandFest beach entrance" }),
  Object.freeze({ name: "DSC08225.jpg", alt: "An accordion band performing for Texas SandFest visitors" })
]);

export const PUBLIC_FIELD_MEDIA = Object.freeze([
  Object.freeze({ name: "Copy of DSC08906.jpg", alt: "A live music performance at Texas SandFest" }),
  Object.freeze({ name: "Photo Apr 27 2025, 12 19 49 PM.jpg", alt: "A Texas SandFest volunteer on the beach" })
]);

export function selectPublicMediaAssets(assets, selection) {
  const assetsByName = new Map((Array.isArray(assets) ? assets : []).map(asset => [asset.name, asset]));
  return (Array.isArray(selection) ? selection : [])
    .map(item => {
      const asset = assetsByName.get(item.name);
      return asset ? { ...asset, alt: asset.alt || item.alt } : null;
    })
    .filter(Boolean);
}
