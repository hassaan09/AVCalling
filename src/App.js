import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = 'http://localhost:8080'; // Update with your server URL
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NTI5Njc0MDRmMjEzZWJmZDVmYjAyOCIsImVtYWlsIjoiYWxwaGFAZ21haWwuY29tIiwidXNlcm5hbWUiOiJhbHBoYSIsImlhdCI6MTczNDc2MTczOCwiZXhwIjoxNzM0ODQ4MTM4fQ.tjgsD6qNt343NP9-kRf4Y9EXVDhhMuuQoFVoFs9_i-4'; // Replace with your actual token

let peerConnection = null;
let localStream = null;
let remoteStream = new MediaStream();

const CallComponent = () => {
  const [socket, setSocket] = useState(null);
  const [receiverId, setReceiverId] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const socketInstance = io(`${SERVER_URL}/im`, {
      query: { token: localStorage.getItem('userToken') }, // Retrieve the token correctly
    });

    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      console.log('Connected to server');
    });

    socketInstance.on('incomingCall', (callData) => {
      console.log(`Incoming call from ${callData.senderName} (${callData.callType})`);
      setIncomingCall(callData);
      setCallStatus('Incoming');
    });

    socketInstance.on('callAnswered', (data) => {
      console.log(`Call ${data.callId} answered`);
      setCallStatus('Answered');
    });

    socketInstance.on('callRejected', (data) => {
      console.log(`Call ${data.callId} rejected`);
      setCallStatus('Rejected');
      setIncomingCall(null);
    });

    socketInstance.on('callEnded', () => {
      console.log('The call has ended.');
      setCallStatus('Ended');
      setIncomingCall(null);
      localStream = null;
      remoteStream = new MediaStream();
    });

    socketInstance.on('remoteStream', (stream) => {
      remoteStream = stream;
      console.log('Received remote stream:', stream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    });

    // Add the missing listener for ICE candidates
    socketInstance.on('iceCandidate', ({ peerId, candidate }) => {
      console.log(`Received ICE Candidate from peerId ${peerId}`);
  
      // Make sure the remote description has been set before adding ICE candidates
      if (peerConnection) {
        // First ensure the remote description is set
        if (peerConnection.remoteDescription) {
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .then(() => {
              console.log('ICE Candidate successfully added');
            })
            .catch((error) => {
              console.error('Error adding ICE Candidate:', error);
            });
        } else {
          console.warn('Remote description not set yet, waiting for it...');
        }
      }
    });

    return () => {
      if (socketInstance) socketInstance.disconnect();
      if (peerConnection) peerConnection.close();
    };
  }, []);

  const configuration = {
    iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "f69b20e8989d12a1b2691442",
        credential: "pwHhl5klFcFaJPer",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "f69b20e8989d12a1b2691442",
        credential: "pwHhl5klFcFaJPer",
      },
    ],
  };

  const setupWebRTCConnection = async (callType) => {
    try {
      console.log('Setting up WebRTC connection...');
      localStream = await navigator.mediaDevices.getUserMedia({
        video: callType === 'video',
        audio: true,
      });
      console.log('Local stream captured:', localStream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      remoteStream = new MediaStream();
      peerConnection = new RTCPeerConnection(configuration);

      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      peerConnection.ontrack = (event) => {
        console.log('Received remote stream track:', event);
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };

      // Fired by STUN server info exchange WEBRTC connection, not signaling server
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE Candidate:', event.candidate);
          socket.emit('iceCandidate', { peerId: incomingCall ? incomingCall.senderId : receiverId, candidate: event.candidate });
        }
      };

      if (callType === 'video') {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { receiverId, offer });
      }
    } catch (err) {
      console.error('Error setting up WebRTC:', err);
    }
  };

  const handleAnswerCall = () => {
    if (socket && incomingCall) {
      console.log('Answering call:', incomingCall);
      socket.emit('answerCall', { callId: incomingCall.callId });
      setCallStatus('Answered');
      setIncomingCall(null);
      setupWebRTCConnection(incomingCall.callType);
    }
  };

  const handleRejectCall = () => {
    if (socket && incomingCall) {
      console.log('Rejecting call:', incomingCall);
      socket.emit('rejectCall', { callId: incomingCall.callId });
      setCallStatus('Rejected');
      setIncomingCall(null);
    }
  };

  const endCall = () => {
    if (socket) {
      socket.emit('endCall');
      console.log('Ending the call');
      setCallStatus('Ended');
      localStream = null;
      remoteStream = new MediaStream();
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
    }
  };

  const initiateCall = (type) => {
    if (socket && receiverId) {
      socket.emit('initiateCall', { receiverId, callType: type });
      console.log(`Initiating ${type} call to ${receiverId}`);
      setCallStatus(`Calling ${receiverId}...`);
      setupWebRTCConnection(type);
    } else {
      console.log('Receiver ID is not set!');
    }
  };

  return (
    <div className="call-container">
      <h2>1-1 Calling</h2>

      <div className="video-call-container">
        <div className="video-box">
          <video ref={localVideoRef} className="local-video" autoPlay muted playsInline />
        </div>

        <div className="video-box">
          <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
        </div>
      </div>

      <div className="call-controls">
        <button className="control-btn" onClick={endCall}>End Call</button>
      </div>

      {incomingCall && callStatus === 'Incoming' && (
        <div className="overlay">
          <div className="overlay-content">
            <h3>Incoming call from {incomingCall.senderName}</h3>
            <button onClick={handleAnswerCall} className="answer-btn">Answer</button>
            <button onClick={handleRejectCall} className="reject-btn">Reject</button>
          </div>
        </div>
      )}

      <div className="call-initiation">
        <input
          type="text"
          placeholder="Enter participant ID"
          value={receiverId}
          onChange={(e) => setReceiverId(e.target.value)}
        />
        <br />
        <button onClick={() => initiateCall('audio')}>Start Audio Call</button>
        <button onClick={() => initiateCall('video')}>Start Video Call</button>
      </div>
    </div>
  );
};

export default CallComponent;
