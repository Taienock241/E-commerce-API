export interface ProductPhoto {
  imageUrl: string;
  alt: string;
  photographer: string;
  photoPage: string;
}

const photos: Array<{ match: string[]; photo: ProductPhoto }> = [
  {
    match: ["mug", "cup", "ceramic"],
    photo: {
      imageUrl: "/images/mug.jpg",
      alt: "White ceramic mug on a pale surface",
      photographer: "Alexandr Marynkin",
      photoPage: "https://unsplash.com/photos/white-ceramic-mug-on-white-surface-oJ9CgpidOco",
    },
  },
  {
    match: ["notebook", "journal", "stationery"],
    photo: {
      imageUrl: "/images/notebook.jpg",
      alt: "Open spiral notebook on a dark wooden table",
      photographer: "Kelly Sikkema",
      photoPage: "https://unsplash.com/photos/white-spiral-notebook-on-black-wooden-table-eBo-8_0i5ic",
    },
  },
  {
    match: ["lamp", "lighting"],
    photo: {
      imageUrl: "/images/lamp.jpg",
      alt: "Grey desk lamp on a home office desk",
      photographer: "Samule Sun",
      photoPage: "https://unsplash.com/photos/grey-desk-lamp-on-top-of-office-desk-U6EXlQCZ938",
    },
  },
  {
    match: ["mouse"],
    photo: {
      imageUrl: "/images/mouse.jpg",
      alt: "Grey and black cordless computer mouse",
      photographer: "Oscar Ivan Esquivel Arteaga",
      photoPage: "https://unsplash.com/photos/closeup-photo-of-gray-and-black-cordless-mouse-ZtxED1cpB1E",
    },
  },
  {
    match: ["bottle", "flask"],
    photo: {
      imageUrl: "/images/bottle.jpg",
      alt: "Minimal white stainless steel water bottle",
      photographer: "Vanesa Giaconi",
      photoPage: "https://unsplash.com/photos/white-bottle-on-white-table-Aej5gA11eHQ",
    },
  },
  {
    match: ["backpack", "bag"],
    photo: {
      imageUrl: "/images/backpack.jpg",
      alt: "Dark blue everyday backpack against a light wall",
      photographer: "Sun Lingyan",
      photoPage: "https://unsplash.com/pt-br/fotografias/mochila-preta-no-chao-branco-_H0fjILH5Vw",
    },
  },
  {
    match: ["phone stand", "phone holder"],
    photo: {
      imageUrl: "/images/phone-stand.jpg",
      alt: "A phone resting on a stand on a desk",
      photographer: "Rohan Krishnan",
      photoPage: "https://unsplash.com/photos/a-cell-phone-on-a-stand-on-a-desk-ZieeEAogV9Y",
    },
  },
  {
    match: ["usb", "cable", "charger"],
    photo: {
      imageUrl: "/images/usb-cable.jpg",
      alt: "Black USB-C cable neatly coiled on a white table",
      photographer: "Mika Baumeister",
      photoPage: "https://unsplash.com/photos/black-usb-cable-on-white-table-RWxeE7wu1T8",
    },
  },
];

export function photoForProduct(name: string): ProductPhoto | undefined {
  const normalizedName = name.toLowerCase();
  return photos.find(({ match }) => match.some((word) => normalizedName.includes(word)))?.photo;
}
