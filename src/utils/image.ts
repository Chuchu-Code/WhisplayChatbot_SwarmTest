import { imageDir, cameraDir } from "./dir";
import fs from "fs";
import path from "path";

export const genImgList: string[] = [];
export const capturedImgList: string[] = [];

let latestDisplayImg = "";
let latestShowedImg = "";

const setLatestShowedImage = (imagePath: string) => {
  latestShowedImg = imagePath;
};

// 加载最新生成的图片路径到list中
const loadLatestGenImg = () => {
  const files = fs.readdirSync(imageDir);
  const images = files
    .filter((file) => /\.(jpg|png)$/.test(file))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(imageDir, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(imageDir, b)).mtime.getTime();
      return aTime - bTime;
    })
    .map((file) => path.join(imageDir, file));
  genImgList.push(...images);
};

loadLatestGenImg();

// 加载最新拍摄的图片路径到list中
const loadLatestCapturedImg = () => {
  // Check if directory exists before reading
  if (!fs.existsSync(cameraDir)) {
    console.log("Camera directory does not exist yet:", cameraDir);
    return;
  }
  
  const files = fs.readdirSync(cameraDir);
  const images = files
    .filter((file) => /\.(jpg|png)$/.test(file))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(cameraDir, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(cameraDir, b)).mtime.getTime();
      return aTime - bTime;
    })
    .map((file) => path.join(cameraDir, file));
  capturedImgList.push(...images);
};

loadLatestCapturedImg();

// Refresh captured images from disk (call this before trying to access a captured image)
const refreshCapturedImgList = () => {
  if (!fs.existsSync(cameraDir)) {
    console.log("Camera directory does not exist:", cameraDir);
    capturedImgList.length = 0;
    return;
  }
  
  const files = fs.readdirSync(cameraDir);
  const images = files
    .filter((file) => /\.(jpg|png)$/.test(file))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(cameraDir, a)).mtime.getTime();
      const bTime = fs.statSync(path.join(cameraDir, b)).mtime.getTime();
      return aTime - bTime;
    })
    .map((file) => path.join(cameraDir, file));
  
  // Replace the entire list with fresh data from disk
  capturedImgList.length = 0;
  capturedImgList.push(...images);
  console.log(`Refreshed captured images: ${capturedImgList.length} files found in ${cameraDir}`);
};

export const setLatestGenImg = (imgPath: string) => {
  genImgList.push(imgPath);
  latestDisplayImg = imgPath;
};

export const getLatestDisplayImg = () => {
  const img = latestDisplayImg;
  latestDisplayImg = "";
  return img;
};

export const showLatestGenImg = () => {
  if (genImgList.length !== 0) {
    latestDisplayImg = genImgList[genImgList.length - 1] || "";
    if (latestDisplayImg) {
      setLatestShowedImage(latestDisplayImg);
    }
    return !!latestDisplayImg;
  } else {
    return false;
  }
};

export const getLatestGenImg = () => {
  return genImgList.length !== 0 ? genImgList[genImgList.length - 1] : "";
};

export const setLatestCapturedImg = (imgPath: string) => {
  capturedImgList.push(imgPath);
  setLatestShowedImage(imgPath);
};

export const getLatestCapturedImg = () => {
  return capturedImgList.length !== 0
    ? capturedImgList[capturedImgList.length - 1]
    : "";
};

export const showLatestCapturedImg = () => {
  if (capturedImgList.length !== 0) {
    latestDisplayImg = capturedImgList[capturedImgList.length - 1] || "";
    if (latestDisplayImg) {
      setLatestShowedImage(latestDisplayImg);
    }
    return !!latestDisplayImg;
  } else {
    return false;
  }
};

export const getLatestShowedImage = () => {
  // Refresh captured images from disk in case new ones were added
  refreshCapturedImgList();
  return latestShowedImg;
};

export const getImageMimeType = (imagePath: string): string => {
  const ext = path.extname(imagePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
};