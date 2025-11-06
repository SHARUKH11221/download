const express = require('express');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
// Render বা অন্য কোনো প্ল্যাটফর্মের জন্য PORT সেট করা
const port = process.env.PORT || 3000;

// CORS middleware ব্যবহার করা হচ্ছে যাতে আপনার APK অ্যাপ সার্ভারের সাথে সংযোগ করতে পারে
app.use(cors());
app.use(express.json());

// 'downloads' ডিরেক্টরি তৈরি করা
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// ডাউনলোড করা ভিডিওগুলো অ্যাক্সেস করার জন্য স্ট্যাটিক পাথ সেট করা
app.use('/downloads', express.static(downloadsDir));

// ডাউনলোড პროგრეს ট্র্যাক করার জন্য একটি অবজেক্ট
const downloadProgress = {};

// মূল রুটে একটি ওয়েলকাম মেসেজ, যা সার্ভার চলছে কিনা তা নিশ্চিত করে
app.get('/', (req, res) => {
    res.status(200).send('Video Downloader Server is running. Frontend is separate.');
});

// '/download' এন্ডপয়েন্ট: ভিডিওর তথ্য পেতে এবং ডাউনলোড শুরু করতে
app.post('/download', async (req, res) => {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
        return res.status(400).json({ success: false, error: 'Invalid or missing YouTube URL' });
    }

    try {
        console.log(`Fetching info for URL: ${url}`);
        const info = await ytdl.getInfo(url);
        const videoId = info.videoDetails.videoId;

        // ফাইলের নামের জন্য ভিডিওর টাইটেলকে নিরাপদ (sanitize) করা হচ্ছে
        const videoTitle = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'video';
        const filename = `${videoTitle} [${videoId}].mp4`;
        const filepath = path.join(downloadsDir, filename);

        // যদি ভিডিওটি আগে থেকেই ডাউনলোড করা থাকে, তাহলে তার তথ্য পাঠিয়ে দেওয়া হচ্ছে
        if (fs.existsSync(filepath)) {
            console.log(`Video already downloaded: ${filename}`);
            return res.status(200).json({
                success: true,
                id: videoId,
                title: info.videoDetails.title,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails.pop().url,
                status: 'completed',
                filePath: `/downloads/${encodeURIComponent(filename)}`
            });
        }

        console.log(`Starting download for: ${info.videoDetails.title}`);

        // ytdl স্ট্রিম শুরু করা
        const videoStream = ytdl(url, {
            quality: 'highest',
            filter: 'videoandaudio'
        });

        // ডাউনলোড პროგრეს শুরু
        downloadProgress[videoId] = {
            progress: 0,
            totalSize: 0,
            downloaded: 0,
            status: 'downloading'
        };

        videoStream.on('response', (response) => {
            downloadProgress[videoId].totalSize = parseInt(response.headers['content-length'], 10);
        });

        videoStream.on('progress', (chunkLength, downloaded, total) => {
            downloadProgress[videoId].progress = (downloaded / total) * 100;
            downloadProgress[videoId].downloaded = downloaded;
        });

        const fileStream = fs.createWriteStream(filepath);
        videoStream.pipe(fileStream);

        fileStream.on('finish', () => {
            console.log(`Finished downloading: ${filename}`);
            downloadProgress[videoId].status = 'completed';
            downloadProgress[videoId].progress = 100;
        });

        fileStream.on('error', (err) => {
            console.error(`Error writing file for video ID ${videoId}:`, err);
            downloadProgress[videoId].status = 'failed';
            // ডাউনলোড ফেইল করলে অসম্পূর্ণ ফাইল ডিলিট করে দেওয়া
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        });

        // ডাউনলোড শুরু হওয়ার সাথে সাথে ক্লায়েন্টকে তথ্য পাঠানো
        return res.status(200).json({
            success: true,
            id: videoId,
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            thumbnail: info.videoDetails.thumbnails.pop().url,
            status: 'downloading',
            filePath: `/downloads/${encodeURIComponent(filename)}`
        });

    } catch (error) {
        console.error('Error in /download endpoint:', error.message);
        // ytdl থেকে আসা সাধারণ ত্রুটি (যেমন IP block) এখানে ধরা পড়বে
        return res.status(500).json({ success: false, error: 'Failed to fetch video information. The server might be blocked by YouTube. Please try again later.' });
    }
});

// '/progress/:id' এন্ডপয়েন্ট: Server-Sent Events (SSE) এর মাধ্যমে პროგრეს পাঠানো
app.get('/progress/:id', (req, res) => {
    const videoId = req.params.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // হেডারগুলো অবিলম্বে পাঠানোর জন্য

    const intervalId = setInterval(() => {
        const progressData = downloadProgress[videoId];
        if (progressData) {
            res.write(`data: ${JSON.stringify(progressData)}\n\n`);

            if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(intervalId);
                res.end();
            }
        }
    }, 1000);

    // ক্লায়েন্ট কানেকশন বন্ধ করলে ইন্টারভাল বন্ধ করা
    req.on('close', () => {
        clearInterval(intervalId);
        res.end();
    });
});

// সার্ভার চালু করা
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});const express = require('express');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
// Render বা অন্য কোনো প্ল্যাটফর্মের জন্য PORT সেট করা
const port = process.env.PORT || 3000;

// CORS middleware ব্যবহার করা হচ্ছে যাতে আপনার APK অ্যাপ সার্ভারের সাথে সংযোগ করতে পারে
app.use(cors());
app.use(express.json());

// 'downloads' ডিরেক্টরি তৈরি করা
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// ডাউনলোড করা ভিডিওগুলো অ্যাক্সেস করার জন্য স্ট্যাটিক পাথ সেট করা
app.use('/downloads', express.static(downloadsDir));

// ডাউনলোড პროგრეს ট্র্যাক করার জন্য একটি অবজেক্ট
const downloadProgress = {};

// মূল রুটে একটি ওয়েলকাম মেসেজ, যা সার্ভার চলছে কিনা তা নিশ্চিত করে
app.get('/', (req, res) => {
    res.status(200).send('Video Downloader Server is running. Frontend is separate.');
});

// '/download' এন্ডপয়েন্ট: ভিডিওর তথ্য পেতে এবং ডাউনলোড শুরু করতে
app.post('/download', async (req, res) => {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
        return res.status(400).json({ success: false, error: 'Invalid or missing YouTube URL' });
    }

    try {
        console.log(`Fetching info for URL: ${url}`);
        const info = await ytdl.getInfo(url);
        const videoId = info.videoDetails.videoId;

        // ফাইলের নামের জন্য ভিডিওর টাইটেলকে নিরাপদ (sanitize) করা হচ্ছে
        const videoTitle = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'video';
        const filename = `${videoTitle} [${videoId}].mp4`;
        const filepath = path.join(downloadsDir, filename);

        // যদি ভিডিওটি আগে থেকেই ডাউনলোড করা থাকে, তাহলে তার তথ্য পাঠিয়ে দেওয়া হচ্ছে
        if (fs.existsSync(filepath)) {
            console.log(`Video already downloaded: ${filename}`);
            return res.status(200).json({
                success: true,
                id: videoId,
                title: info.videoDetails.title,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails.pop().url,
                status: 'completed',
                filePath: `/downloads/${encodeURIComponent(filename)}`
            });
        }

        console.log(`Starting download for: ${info.videoDetails.title}`);

        // ytdl স্ট্রিম শুরু করা
        const videoStream = ytdl(url, {
            quality: 'highest',
            filter: 'videoandaudio'
        });

        // ডাউনলোড პროგრეს শুরু
        downloadProgress[videoId] = {
            progress: 0,
            totalSize: 0,
            downloaded: 0,
            status: 'downloading'
        };

        videoStream.on('response', (response) => {
            downloadProgress[videoId].totalSize = parseInt(response.headers['content-length'], 10);
        });

        videoStream.on('progress', (chunkLength, downloaded, total) => {
            downloadProgress[videoId].progress = (downloaded / total) * 100;
            downloadProgress[videoId].downloaded = downloaded;
        });

        const fileStream = fs.createWriteStream(filepath);
        videoStream.pipe(fileStream);

        fileStream.on('finish', () => {
            console.log(`Finished downloading: ${filename}`);
            downloadProgress[videoId].status = 'completed';
            downloadProgress[videoId].progress = 100;
        });

        fileStream.on('error', (err) => {
            console.error(`Error writing file for video ID ${videoId}:`, err);
            downloadProgress[videoId].status = 'failed';
            // ডাউনলোড ফেইল করলে অসম্পূর্ণ ফাইল ডিলিট করে দেওয়া
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        });

        // ডাউনলোড শুরু হওয়ার সাথে সাথে ক্লায়েন্টকে তথ্য পাঠানো
        return res.status(200).json({
            success: true,
            id: videoId,
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            thumbnail: info.videoDetails.thumbnails.pop().url,
            status: 'downloading',
            filePath: `/downloads/${encodeURIComponent(filename)}`
        });

    } catch (error) {
        console.error('Error in /download endpoint:', error.message);
        // ytdl থেকে আসা সাধারণ ত্রুটি (যেমন IP block) এখানে ধরা পড়বে
        return res.status(500).json({ success: false, error: 'Failed to fetch video information. The server might be blocked by YouTube. Please try again later.' });
    }
});

// '/progress/:id' এন্ডপয়েন্ট: Server-Sent Events (SSE) এর মাধ্যমে პროგრეს পাঠানো
app.get('/progress/:id', (req, res) => {
    const videoId = req.params.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // হেডারগুলো অবিলম্বে পাঠানোর জন্য

    const intervalId = setInterval(() => {
        const progressData = downloadProgress[videoId];
        if (progressData) {
            res.write(`data: ${JSON.stringify(progressData)}\n\n`);

            if (progressData.status === 'completed' || progressData.status === 'failed') {
                clearInterval(intervalId);
                res.end();
            }
        }
    }, 1000);

    // ক্লায়েন্ট কানেকশন বন্ধ করলে ইন্টারভাল বন্ধ করা
    req.on('close', () => {
        clearInterval(intervalId);
        res.end();
    });
});

// সার্ভার চালু করা
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
